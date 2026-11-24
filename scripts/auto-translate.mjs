/**
 * Fill empty and stale localized content via POST /api/translate.
 * Importable: `runAutoTranslate` runs the pipeline. The CLI starts only when
 * this file is executed directly.
 *
 *   node scripts/auto-translate.mjs --dry-run
 *   node scripts/auto-translate.mjs --mock
 *   node scripts/auto-translate.mjs --file content/packages/example.json
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  TARGET_LOCALES,
  TRANSLATE_MODEL,
  buildSystemPrompt,
  collectFields,
  contextForFolder,
  estimateNeurons,
  estimateTokensFromChars,
  hashCanonical,
  mockTranslate,
  packBatches,
  validateTranslation,
} from "./lib/auto-translate-core.mjs";

const FOLDERS = ["packages", "destinations", "pages", "blog"];
/** Four attempts. The waits between them are 5s, 15s, and 30s. */
const NETWORK_BACKOFF_MS = [5_000, 15_000, 30_000];
const NETWORK_ATTEMPTS = 4;

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const files = [];
  let dryRun = false;
  let mock = false;
  let maxCalls = null;
  let maxNeurons = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--mock") mock = true;
    else if (arg === "--file") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--file needs a path");
      files.push(value);
      i += 1;
    } else if (arg.startsWith("--file=")) files.push(arg.slice("--file=".length));
    else if (arg === "--max-calls") {
      maxCalls = numberArg(argv[i + 1], "--max-calls");
      i += 1;
    } else if (arg.startsWith("--max-calls=")) maxCalls = numberArg(arg.slice("--max-calls=".length), "--max-calls");
    else if (arg === "--max-neurons") {
      maxNeurons = numberArg(argv[i + 1], "--max-neurons");
      i += 1;
    } else if (arg.startsWith("--max-neurons=")) {
      maxNeurons = numberArg(arg.slice("--max-neurons=".length), "--max-neurons");
    } else throw new Error(`Unknown argument ${arg}`);
  }
  return { files, dryRun, mock, maxCalls, maxNeurons };
}

function numberArg(value, flag) {
  if (value == null || value.startsWith("--")) throw new Error(`${flag} needs a number`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} needs a number >= 0`);
  return n;
}

function envNumber(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function posixRel(cwd, file) {
  return relative(cwd, file).split(sep).join("/");
}

function listContentFiles(cwd, fileArgs) {
  if (fileArgs.length > 0) {
    return fileArgs.map((file) => {
      const absolute = isAbsolute(file) ? file : join(cwd, file);
      const rel = posixRel(cwd, absolute);
      if (!/^content\/(packages|destinations|pages|blog)\/[^/]+\.json$/.test(rel)) {
        throw new Error(`--file must be a JSON file in content/{packages,destinations,pages,blog}: ${rel}`);
      }
      return absolute;
    });
  }
  const out = [];
  for (const folder of FOLDERS) {
    const dir = join(cwd, "content", folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".json")) out.push(join(dir, name));
    }
  }
  out.sort();
  return out;
}

function sidecarPath(cwd, contentFile) {
  return join(cwd, "content", ".translations", relative(join(cwd, "content"), contentFile));
}

function readSidecar(file) {
  if (!existsSync(file)) return { version: 1, fields: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { version: 1, fields: {} };
    if (!parsed.fields || typeof parsed.fields !== "object" || Array.isArray(parsed.fields)) parsed.fields = {};
    parsed.version = 1;
    return parsed;
  } catch {
    return { version: 1, fields: {} };
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function blankCounts() {
  return { missing: 0, stale: 0, human: 0, current: 0 };
}

function itemsForField(field, locale) {
  const status = field.statuses[locale];
  if (status !== "missing" && status !== "stale") return [];
  if (field.kind === "keywords") {
    const english = field.english || {};
    const keywords = Array.isArray(english.keywords) ? english.keywords : [];
    const title = typeof english.seo_title === "string" ? english.seo_title : "";
    const focus = typeof english.focus_keyword === "string" ? english.focus_keyword : "";
    return [
      {
        id: field.path,
        mode: "keywords",
        fieldPath: field.path,
        locale,
        title,
        focus_keyword: focus,
        keywords,
        chars: title.length + focus.length + keywords.join("").length,
      },
    ];
  }
  if (field.kind === "list") {
    const items = [];
    field.english.forEach((text, index) => {
      if (typeof text !== "string" || text.trim() === "") return;
      items.push({
        id: `${field.path}#[${index}]`,
        mode: "translate",
        fieldPath: field.path,
        index,
        locale,
        text,
        chars: text.length,
      });
    });
    return items;
  }
  const text = typeof field.english === "string" ? field.english : "";
  return [
    {
      id: field.path,
      mode: "translate",
      fieldPath: field.path,
      locale,
      text,
      chars: text.length,
    },
  ];
}

function requestItems(items) {
  return items.map((item) => {
    if (item.mode === "keywords") {
      return {
        id: item.id,
        title: item.title,
        focus_keyword: item.focus_keyword,
        keywords: item.keywords,
      };
    }
    return { id: item.id, text: item.text };
  });
}

function callEstimate(locale, mode, items, context) {
  const system = buildSystemPrompt(locale, mode);
  const payload = JSON.stringify({ target: locale, mode, context, items: requestItems(items) });
  const promptTokens = estimateTokensFromChars(system.length + payload.length);
  const sourceChars = items.reduce((sum, item) => sum + item.chars, 0);
  const completionTokens = estimateTokensFromChars(Math.max(sourceChars, 1));
  return {
    promptTokens,
    completionTokens,
    neurons: estimateNeurons(TRANSLATE_MODEL, promptTokens, completionTokens),
  };
}

function usageOf(body, fallbackPrompt, fallbackCompletion) {
  const usage = body && body.usage;
  if (usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)) {
    return { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens };
  }
  return {
    prompt_tokens: estimateTokensFromChars(fallbackPrompt),
    completion_tokens: estimateTokensFromChars(fallbackCompletion),
  };
}

const CONCURRENCY = Math.max(1, Number(process.env.MT_CONCURRENCY) || 6);
/** Smaller batches keep each Workers AI call well under a minute. */
const BATCH_CHARS = Math.max(500, Number(process.env.MT_BATCH_CHARS) || 3500);

function overCap(state, estimate) {
  if (state.calls + 1 > state.maxCalls) return true;
  if (state.neurons + estimate.neurons > state.maxNeurons) return true;
  return false;
}

function remember(sidecar, field, locale, output) {
  if (!sidecar.fields[field.path] || typeof sidecar.fields[field.path] !== "object") sidecar.fields[field.path] = {};
  sidecar.fields[field.path].src = hashCanonical(field.english);
  sidecar.fields[field.path][locale] = hashCanonical(output);
  sidecar.version = 1;
}

function assemble(field, results) {
  if (field.kind === "keywords") {
    const value = results.get(field.path);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, missing: [field.path] };
    return { value, missing: [] };
  }
  if (field.kind === "list") {
    const output = [];
    const missing = [];
    field.english.forEach((text, index) => {
      if (typeof text !== "string" || text.trim() === "") {
        output.push("");
        return;
      }
      const id = `${field.path}#[${index}]`;
      const value = results.get(id);
      if (typeof value !== "string") missing.push(id);
      output.push(typeof value === "string" ? value : "");
    });
    return { value: output, missing };
  }
  const value = results.get(field.path);
  if (typeof value !== "string") return { value: "", missing: [field.path] };
  return { value, missing: [] };
}

function failedIds(field, validation, missing) {
  const ids = new Set(missing);
  if (field.kind === "list") {
    if (!validation.ok) {
      let indexed = false;
      for (const reason of validation.reasons) {
        const match = /^\[(\d+)\]/.exec(reason);
        if (!match) continue;
        indexed = true;
        const index = Number(match[1]);
        const text = field.english[index];
        if (typeof text === "string" && text.trim()) ids.add(`${field.path}#[${index}]`);
      }
      if (!indexed) {
        field.english.forEach((text, index) => {
          if (typeof text === "string" && text.trim()) ids.add(`${field.path}#[${index}]`);
        });
      }
    }
    return [...ids];
  }
  if (!validation.ok || missing.length > 0) return [field.path];
  return [];
}

function storedOutput(field, value) {
  if (field.kind !== "keywords") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { focus_keyword: "", keywords: [] };
  return {
    focus_keyword: typeof value.focus_keyword === "string" ? value.focus_keyword.trim() : "",
    keywords: Array.isArray(value.keywords) ? value.keywords.map((item) => (typeof item === "string" ? item.trim() : "")) : [],
  };
}

function normalizeUrl(url) {
  return url.replace(/([^:])\/{2,}/g, "$1/");
}

async function httpTranslate(url, secret, payload, fetchImpl, sleep) {
  let lastReason = "network";
  for (let attempt = 0; attempt < NETWORK_ATTEMPTS; attempt += 1) {
    let retry = false;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-translate-secret": secret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });
      const status = response.status;
      if (status === 404 || status === 405) return { type: "pending", reason: `HTTP ${status}` };
      if (status === 401) return { type: "unauthorized" };
      if (status === 413 || status === 400) return { type: "rejected", status };
      if (status === 503) {
        let error = "";
        try {
          const parsed = await response.json();
          error = parsed && typeof parsed.error === "string" ? parsed.error : "";
        } catch {
          error = "";
        }
        if (error === "not_configured" || error === "") return { type: "pending", reason: "not_configured" };
        lastReason = "HTTP 503";
        retry = true;
      } else if (status >= 300 && status < 400) {
        lastReason = `HTTP ${status}`;
        retry = true;
      } else if (!response.ok) {
        lastReason = `HTTP ${status}`;
        retry = true;
      } else {
        const body = await response.json();
        return { type: "ok", body };
      }
    } catch {
      lastReason = "network";
      retry = true;
    }
    if (!retry) return { type: "pending", reason: lastReason };
    if (attempt < NETWORK_ATTEMPTS - 1) await sleep(NETWORK_BACKOFF_MS[Math.min(attempt, NETWORK_BACKOFF_MS.length - 1)]);
  }
  return { type: "pending", reason: lastReason };
}

function mockResponse(locale, mode, items) {
  const results = mockTranslate(locale, mode, requestItems(items));
  const ids = items.map((item) => item.id);
  return {
    model: TRANSLATE_MODEL,
    results,
    missing: ids.filter((id) => !Object.prototype.hasOwnProperty.call(results, id)),
    usage: {
      prompt_tokens: estimateTokensFromChars(JSON.stringify(requestItems(items)).length + 800),
      completion_tokens: estimateTokensFromChars(JSON.stringify(results).length),
    },
  };
}

function absorbResults(results, body) {
  const map = body && body.results && typeof body.results === "object" ? body.results : {};
  for (const [id, value] of Object.entries(map)) results.set(id, value);
}

function markdownSummary(summary) {
  const lines = [
    "### Machine translation",
    "",
    `- Files changed: ${summary.filesChanged}`,
    `- Fields translated: ${TARGET_LOCALES.map((locale) => `${locale} ${summary.translated[locale]}`).join(", ")}`,
    `- Calls: ${summary.calls}`,
    `- Tokens: prompt ${summary.promptTokens}, completion ${summary.completionTokens}`,
    `- Estimated neurons: ${summary.neurons.toFixed(4)}`,
    `- Pending: ${summary.pending ? "true" : "false"}`,
    "",
    "#### Human-owned skipped",
  ];
  if (summary.human.length === 0) lines.push("- (none)");
  for (const item of summary.human) lines.push(`- \`${item.file}\` ${item.locale} \`${item.path}\``);
  lines.push("", "#### Failures");
  if (summary.failures.length === 0) lines.push("- (none)");
  for (const item of summary.failures) {
    lines.push(`- \`${item.file}\` ${item.locale} \`${item.path}\`: ${item.reasons.join("; ")}`);
  }
  lines.push("", "#### Left for the next run");
  if (summary.deferred.length === 0) lines.push("- (none)");
  for (const item of summary.deferred) lines.push(`- \`${item.file}\` ${item.locale} \`${item.path}\``);
  return lines.join("\n");
}

function printSummary(summary, log) {
  const files = Object.keys(summary.counts).sort();
  for (const file of files) {
    log(file);
    for (const locale of TARGET_LOCALES) {
      const counts = summary.counts[file][locale];
      log(
        `  ${locale}  missing=${counts.missing} stale=${counts.stale} human=${counts.human} current=${counts.current}`,
      );
    }
  }
  log(`planned calls: ${summary.dryRun ? summary.calls : summary.plannedCalls}`);
  log(`estimated neurons: ${summary.neurons.toFixed(4)}`);
  log(`files changed: ${summary.filesChanged}`);
  log(`fields translated: ${TARGET_LOCALES.map((locale) => `${locale} ${summary.translated[locale]}`).join(", ")}`);
  log(`human-owned skipped: ${summary.human.length}`);
  for (const item of summary.human) log(`  human ${item.file} ${item.locale} ${item.path}`);
  log(`failures: ${summary.failures.length}`);
  for (const item of summary.failures) log(`  fail ${item.file} ${item.locale} ${item.path}: ${item.reasons.join("; ")}`);
  log(`calls: ${summary.calls}`);
  log(`tokens: prompt ${summary.promptTokens}, completion ${summary.completionTokens}`);
  log(`left for next run: ${summary.deferred.length}`);
  for (const item of summary.deferred) log(`  left ${item.file} ${item.locale} ${item.path}`);
  if (summary.pending) log("pending=true");
}

function writeGithub(env, summary) {
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `changed=${summary.filesChanged > 0 ? "true" : "false"}\n`);
    appendFileSync(env.GITHUB_OUTPUT, `pending=${summary.pending ? "true" : "false"}\n`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `\n${markdownSummary(summary)}\n`);
  }
}

function emptySummary() {
  return {
    filesChanged: 0,
    translated: { de: 0, fr: 0, ja: 0, es: 0 },
    human: [],
    failures: [],
    deferred: [],
    counts: {},
    calls: 0,
    plannedCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    neurons: 0,
    pending: false,
    dryRun: false,
  };
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>, translate?: Function, stdout?: (line: string) => void, stderr?: (line: string) => void }} [hooks]
 */
export async function runAutoTranslate(argv = [], hooks = {}) {
  const env = hooks.env ?? process.env;
  const cwd = hooks.cwd ?? process.cwd();
  const fetchImpl = hooks.fetch ?? globalThis.fetch;
  const sleep = hooks.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = hooks.stdout ?? ((line) => console.log(line));
  const warn = hooks.stderr ?? ((line) => console.error(line));
  const args = parseArgs(argv);
  const summary = emptySummary();
  summary.dryRun = args.dryRun;
  const state = {
    calls: 0,
    neurons: 0,
    maxCalls: args.maxCalls ?? envNumber(env.MT_MAX_CALLS, 150),
    maxNeurons: args.maxNeurons ?? envNumber(env.MT_MAX_NEURONS, 8000),
  };

  const finish = (code) => {
    printSummary(summary, log);
    writeGithub(env, summary);
    return { code, ...summary };
  };

  if (!args.dryRun && !args.mock && !hooks.translate && !env.TRANSLATE_SECRET) {
    warn("TRANSLATE_SECRET is empty. Skipping machine translation.");
    summary.pending = false;
    return finish(0);
  }

  const files = listContentFiles(cwd, args.files);
  const url = normalizeUrl(env.TRANSLATE_URL || "https://sundayatlastravel.com/api/translate");

  const account = (body, estimate) => {
    const usage = usageOf(body, estimate.promptTokens * 4, estimate.completionTokens * 4);
    const model = body && typeof body.model === "string" ? body.model : TRANSLATE_MODEL;
    state.calls += 1;
    summary.calls = state.calls;
    summary.promptTokens += usage.prompt_tokens;
    summary.completionTokens += usage.completion_tokens;
    state.neurons += estimateNeurons(model, usage.prompt_tokens, usage.completion_tokens);
    summary.neurons = state.neurons;
  };

  const dispatch = async (locale, mode, items, context) => {
    const estimate = callEstimate(locale, mode, items, context);
    summary.plannedCalls += 1;
    if (args.dryRun) {
      state.calls += 1;
      summary.calls = state.calls;
      state.neurons += estimate.neurons;
      summary.neurons = state.neurons;
      summary.promptTokens += estimate.promptTokens;
      summary.completionTokens += estimate.completionTokens;
      return { type: "dry" };
    }
    if (args.mock) {
      const body = mockResponse(locale, mode, items);
      account(body, estimate);
      return { type: "ok", body };
    }
    if (hooks.translate) {
      const body = await hooks.translate({ target: locale, mode, items: requestItems(items), context });
      account(body, estimate);
      return { type: "ok", body };
    }
    const result = await httpTranslate(
      url,
      env.TRANSLATE_SECRET,
      { target: locale, mode, context, items: requestItems(items) },
      fetchImpl,
      sleep,
    );
    if (result.type === "ok") account(result.body, estimate);
    return result;
  };

  let stop = false;
  let pendingReason = "";

  for (const file of files) {
    if (stop) break;
    const rel = posixRel(cwd, file);
    const folder = rel.split("/")[1];
    const context = contextForFolder(folder);
    const original = readFileSync(file, "utf8");
    const doc = JSON.parse(original);
    const sideFile = sidecarPath(cwd, file);
    const originalSide = existsSync(sideFile) ? readFileSync(sideFile, "utf8") : "";
    const sidecar = readSidecar(sideFile);
    const fields = collectFields(doc, sidecar);
    summary.counts[rel] = {};
    for (const locale of TARGET_LOCALES) {
      summary.counts[rel][locale] = blankCounts();
      for (const field of fields) {
        const status = field.statuses[locale];
        if (status === "skip") continue;
        summary.counts[rel][locale][status] += 1;
        if (status === "human") summary.human.push({ file: rel, locale, path: field.path });
      }
    }

    let dirty = false;
    let sideDirty = false;

    const seen = new Set();
    const mark = (locale, path) => seen.add(`${locale}:${path}`);

    const flush = () => {
      if (args.dryRun) return;
      if (dirty) {
        const next = serialize(doc);
        if (next !== original) {
          writeFileSync(file, next);
          summary.filesChanged += 1;
        }
        dirty = false;
      }
      if (sideDirty) {
        const next = serialize(sidecar);
        if (next !== originalSide) {
          mkdirSync(dirname(sideFile), { recursive: true });
          writeFileSync(sideFile, next);
        }
        sideDirty = false;
      }
    };

    // Plan every locale first, then send all batches of this file through a small
    // concurrent pool (MT_CONCURRENCY, default 6). Mistral Small writes about 20
    // tokens/s, so sequential calls would not fit the job timeout.
    const plans = TARGET_LOCALES.map((locale) => {
      const chosen = fields.filter((field) => field.statuses[locale] === "missing" || field.statuses[locale] === "stale");
      const items = chosen.flatMap((field) => itemsForField(field, locale));
      const batches = [];
      for (const mode of ["translate", "keywords"]) {
        batches.push(...packBatches(items.filter((item) => item.mode === mode), 30, BATCH_CHARS));
      }
      return { locale, chosen, items, batches, results: new Map(), deferredIds: new Set(), rejected: new Set() };
    });
    const jobs = plans.flatMap((plan) => plan.batches.map((batch) => ({ plan, batch })));
    let unauthorized = false;
    const runJob = async ({ plan, batch }) => {
      if (stop || unauthorized) {
        for (const item of batch) plan.deferredIds.add(item.id);
        return;
      }
      const estimate = callEstimate(plan.locale, batch[0].mode, batch, context);
      if (overCap(state, estimate)) {
        stop = true;
        for (const item of batch) plan.deferredIds.add(item.id);
        return;
      }
      const response = await dispatch(plan.locale, batch[0].mode, batch, context);
      if (response.type === "pending") {
        summary.pending = true;
        pendingReason = response.reason || "unavailable";
        stop = true;
        for (const item of batch) plan.deferredIds.add(item.id);
        return;
      }
      if (response.type === "unauthorized") {
        unauthorized = true;
        return;
      }
      if (response.type === "rejected") {
        for (const item of batch) plan.rejected.add(item.fieldPath);
        return;
      }
      if (response.type === "ok") absorbResults(plan.results, response.body);
    };
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(CONCURRENCY, jobs.length)) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor];
        cursor += 1;
        await runJob(job);
      }
    });
    await Promise.all(workers);
    if (unauthorized) {
      flush();
      warn(
        "Translation endpoint returned 401 unauthorized. The GitHub secret TRANSLATE_SECRET does not match the Pages secret. The secret value was not printed.",
      );
      summary.pending = false;
      printSummary(summary, log);
      writeGithub(env, summary);
      return { code: 1, ...summary };
    }

    for (const plan of plans) {
      const { locale, chosen, items, results, deferredIds, rejected } = plan;

      const deferredFields = new Set();
      for (const field of chosen) {
        const fieldItems = items.filter((item) => item.fieldPath === field.path);
        if (fieldItems.some((item) => deferredIds.has(item.id))) deferredFields.add(field.path);
      }
      for (const field of chosen) {
        if (!deferredFields.has(field.path)) continue;
        summary.deferred.push({ file: rel, locale, path: field.path });
        mark(locale, field.path);
      }
      if (args.dryRun) {
        for (const field of chosen) {
          if (deferredFields.has(field.path)) continue;
          mark(locale, field.path);
        }
        continue;
      }
      for (const field of chosen) {
        if (!rejected.has(field.path) || deferredFields.has(field.path)) continue;
        summary.failures.push({
          file: rel,
          locale,
          path: field.path,
          reasons: ["endpoint rejected the batch"],
        });
        mark(locale, field.path);
      }

      for (const field of chosen) {
        if (deferredFields.has(field.path) || rejected.has(field.path)) continue;
        const fieldItems = items.filter((item) => item.fieldPath === field.path);
        if (fieldItems.length === 0) continue;
        let assembled = assemble(field, results);
        let validation = validateTranslation(field.english, storedOutput(field, assembled.value), locale);
        let failed = failedIds(field, validation, assembled.missing);
        if (failed.length > 0 && !summary.pending) {
          const retryItems = fieldItems.filter((item) => failed.includes(item.id));
          const retryEstimate = callEstimate(locale, retryItems[0]?.mode || "translate", retryItems, context);
          if (retryItems.length === 0 || overCap(state, retryEstimate)) {
            summary.failures.push({
              file: rel,
              locale,
              path: field.path,
              reasons: validation.reasons.length ? validation.reasons : ["missing translation"],
            });
            mark(locale, field.path);
            continue;
          }
          const response = await dispatch(locale, retryItems[0].mode, retryItems, context);
          if (response.type === "pending") {
            summary.pending = true;
            pendingReason = response.reason || "unavailable";
            stop = true;
            summary.failures.push({
              file: rel,
              locale,
              path: field.path,
              reasons: validation.reasons.length ? validation.reasons : ["missing translation"],
            });
            mark(locale, field.path);
            break;
          }
          if (response.type === "unauthorized") {
            flush();
            warn(
              "Translation endpoint returned 401 unauthorized. The GitHub secret TRANSLATE_SECRET does not match the Pages secret. The secret value was not printed.",
            );
            summary.pending = false;
            printSummary(summary, log);
            writeGithub(env, summary);
            return { code: 1, ...summary };
          }
          if (response.type === "ok") absorbResults(results, response.body);
          assembled = assemble(field, results);
          validation = validateTranslation(field.english, storedOutput(field, assembled.value), locale);
          failed = failedIds(field, validation, assembled.missing);
        }
        if (failed.length > 0 || !validation.ok) {
          summary.failures.push({
            file: rel,
            locale,
            path: field.path,
            reasons: validation.reasons.length ? validation.reasons : ["missing translation"],
          });
          mark(locale, field.path);
          continue;
        }
        mark(locale, field.path);
        if (args.dryRun) continue;
        const output = storedOutput(field, assembled.value);
        field.set(locale, output);
        remember(sidecar, field, locale, output);
        summary.translated[locale] += 1;
        dirty = true;
        sideDirty = true;
      }
    }

    if (stop) {
      for (const locale of TARGET_LOCALES) {
        for (const field of fields) {
          const status = field.statuses[locale];
          if (status !== "missing" && status !== "stale") continue;
          if (seen.has(`${locale}:${field.path}`)) continue;
          summary.deferred.push({ file: rel, locale, path: field.path });
          mark(locale, field.path);
        }
      }
    }

    if (!args.dryRun) {
      // Publish a locale (seo.<locale>.noindex -> false) only when the pipeline owns
      // fields there and every field for that locale is now filled and passed validation.
      // The pipeline never sets noindex to true.
      const after = collectFields(doc, sidecar);
      for (const locale of TARGET_LOCALES) {
        const block = doc.seo && typeof doc.seo === "object" ? doc.seo[locale] : null;
        if (!block || typeof block !== "object" || block.noindex !== true) continue;
        const owned = Object.values(sidecar.fields || {}).some((record) => record && record[locale]);
        if (!owned) continue;
        const problems = [...summary.failures, ...summary.deferred].filter(
          (entry) => entry.file === rel && entry.locale === locale,
        );
        const open = after.filter((field) => ["missing", "stale"].includes(field.statuses[locale]));
        const seoReady =
          typeof block.seo_title === "string" && block.seo_title.trim() !== "" &&
          typeof block.meta_description === "string" && block.meta_description.trim() !== "" &&
          Array.isArray(block.keywords) && block.keywords.length > 0;
        if (problems.length === 0 && open.length === 0 && seoReady) {
          block.noindex = false;
          sidecar.noindex = { ...(sidecar.noindex || {}), [locale]: "pipeline" };
          summary.published = [...(summary.published || []), `${rel} ${locale}`];
          log(`published ${rel} ${locale} (noindex false)`);
          dirty = true;
          sideDirty = true;
        } else {
          log(`kept noindex ${rel} ${locale}: ${problems.length} failed/deferred, ${open.length} open, seo ${seoReady ? "ready" : "incomplete"}`);
        }
      }
    }

    flush();
  }

  if (summary.pending) {
    warn(`Machine translation is pending (${pendingReason}). Exiting without failure.`);
  }
  return finish(0);
}

if (invokedDirectly()) {
  runAutoTranslate(process.argv.slice(2))
    .then((result) => {
      process.exit(result.code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
