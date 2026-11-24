import { visionModels, runVisionModels } from "./vision-model-policy.mjs";
/**
 * AI client for the blog pipeline.
 *
 * Callers ask for a *role* (TEXT_MODEL = long-form writing, TRANSLATE_MODEL = translation);
 * each role maps to an ordered chain of providers, first success wins:
 *
 *   1. NVIDIA     NVIDIA_API_KEY — build.nvidia.com's free OpenAI-compatible API
 *                 (https://integrate.api.nvidia.com/v1). Primary + fallback model per role.
 *                 429s/5xx/timeouts back off (honouring Retry-After) before moving on.
 *   2. Cloudflare Workers AI, last resort only, so the free neuron allowance stays for the
 *                 site's own chat/translate features:
 *                   rest      CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_API_TOKEN
 *                   endpoint  TRANSLATE_SECRET (+ optional BLOG_AI_URL, default production /api/blog-ai)
 *   mock         BLOG_AI_MOCK=1 (dry runs and tests; no network) short-circuits everything.
 *
 * Overrides: BLOG_NVIDIA_TEXT_MODELS / BLOG_NVIDIA_TRANSLATE_MODELS (comma lists),
 * BLOG_CF_TEXT_MODEL / BLOG_CF_TRANSLATE_MODEL, BLOG_CF_FALLBACK=0 to never touch Workers AI,
 * NVIDIA_BASE_URL. Every call is metered into `ledger` (tokens per model; neurons only for
 * Cloudflare calls, since NVIDIA calls do not use Cloudflare's allowance).
 */
import { estimateNeurons } from "./auto-translate-core.mjs";

export const TEXT_MODEL = "text";
export const TRANSLATE_MODEL = "translate";
export const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

const list = (v, d) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : d;
export const NVIDIA_MODELS = {
  text: list(process.env.BLOG_NVIDIA_TEXT_MODELS, [
    "nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia/nemotron-3.5-super-vl-120b-a12b",
  ]),
  translate: list(process.env.BLOG_NVIDIA_TRANSLATE_MODELS, [
    "nvidia/nemotron-3.5-super-vl-120b-a12b",
    "nvidia/nemotron-3-ultra-550b-a55b",
  ]),
};
/**
 * Translation models per target language, first = primary. Probed 2026-10-30 on the free key:
 * only the two Nemotron models answer (others 404 or time out); 3.5-super is 2-5 s per
 * paragraph and passes the gates in ja/fr/de/es, 3-ultra is 3-13 s. Override per language with
 * BLOG_NVIDIA_TRANSLATE_MODELS_JA="a,b" (DE/FR/ES likewise) or all at once with
 * BLOG_NVIDIA_TRANSLATE_MODELS_BY_LOCALE='{"ja":["a","b"]}'.
 */
const SUPER = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
const DEFAULT_LOCALE_MODELS = {
  de: [SUPER, ULTRA],
  fr: [SUPER, ULTRA],
  ja: [SUPER, ULTRA],
  es: [SUPER, ULTRA],
  zh: [SUPER, ULTRA],
};
function localeModelMap() {
  let json = {};
  try {
    json = JSON.parse(process.env.BLOG_NVIDIA_TRANSLATE_MODELS_BY_LOCALE || "{}") || {};
  } catch {
    json = {};
  }
  const map = {};
  for (const [l, d] of Object.entries(DEFAULT_LOCALE_MODELS)) {
    const fromEnv = list(process.env[`BLOG_NVIDIA_TRANSLATE_MODELS_${l.toUpperCase()}`], null);
    const fromJson = Array.isArray(json[l]) ? json[l].filter((m) => typeof m === "string" && m) : null;
    // BLOG_NVIDIA_TRANSLATE_MODELS (all languages) still wins over the built-in defaults.
    const global = process.env.BLOG_NVIDIA_TRANSLATE_MODELS ? NVIDIA_MODELS.translate : null;
    map[l] = fromEnv || (fromJson?.length ? fromJson : null) || global || d;
  }
  return map;
}
export const NVIDIA_TRANSLATE_BY_LOCALE = localeModelMap();
/** NVIDIA translation models for one language (primary first). */
export function translateModelsFor(locale) {
  return NVIDIA_TRANSLATE_BY_LOCALE[locale] ?? NVIDIA_MODELS.translate;
}

/**
 * Concurrency limiter: at most `max` tasks run at once; the rest wait in FIFO order.
 * `run(fn)` resolves/rejects with fn's result.
 */
export function createLimiter(max) {
  const limit = Math.max(1, Math.floor(Number(max) || 1));
  let active = 0;
  let peak = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active += 1;
    peak = Math.max(peak, active);
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return {
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    },
    get active() {
      return active;
    },
    get peak() {
      return peak;
    },
    get pending() {
      return queue.length;
    },
  };
}

/** Map over items with at most `max` in flight; results keep the input order. */
export async function mapLimit(items, max, fn) {
  const limiter = createLimiter(max);
  return Promise.all(items.map((item, i) => limiter.run(() => fn(item, i))));
}

export const CF_MODELS = {
  text:
    process.env.BLOG_CF_TEXT_MODEL ||
    process.env.BLOG_TEXT_MODEL ||
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  translate:
    process.env.BLOG_CF_TRANSLATE_MODEL ||
    process.env.BLOG_TRANSLATE_MODEL ||
    "@cf/mistralai/mistral-small-3.1-24b-instruct",
};
const NVIDIA_BASE = (
  process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"
).replace(/\/$/, "");
const NVIDIA_TIMEOUT_MS = Number(process.env.BLOG_NVIDIA_TIMEOUT_MS || 240_000);
const VISION_TIMEOUT_MS = Number(process.env.BLOG_NVIDIA_VISION_TIMEOUT_MS || 45_000);
// Free tier is ~40 requests/minute; keep well under it.
// Requests are started at least this far apart (3 s ≈ 20/min) across all concurrent callers.
const NVIDIA_MIN_INTERVAL_MS = Number(
  process.env.BLOG_NVIDIA_MIN_INTERVAL_MS || 3_000,
);
/** Max NVIDIA requests in flight across the whole run (all languages and fields share it). */
export const NVIDIA_CONCURRENCY = Number(process.env.BLOG_NVIDIA_CONCURRENCY || 2);
const nvidiaLimiter = createLimiter(NVIDIA_CONCURRENCY);
export function nvidiaPeakConcurrency() {
  return nvidiaLimiter.peak;
}
const NVIDIA_BACKOFF_S = [5, 15, 30, 60];

export const ledger = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  neurons: 0,
  images: 0,
  byModel: {},
  nvidia: {
    calls: 0,
    rateLimited: 0,
    serverErrors: 0,
    timeouts: 0,
    modelFallbacks: 0,
    cloudflareFallbacks: 0,
    unavailableModels: [],
  },
};

function record(
  model,
  usage,
  promptChars,
  completionChars,
  provider = "cloudflare",
) {
  const p = usage?.prompt_tokens || Math.ceil(promptChars / 4);
  const c = usage?.completion_tokens || Math.ceil(completionChars / 4);
  const n = provider === "cloudflare" ? estimateNeurons(model, p, c) : 0;
  ledger.calls += 1;
  ledger.promptTokens += p;
  ledger.completionTokens += c;
  ledger.neurons += n;
  const m = (ledger.byModel[model] ??= {
    provider,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    neurons: 0,
  });
  m.calls += 1;
  m.promptTokens += p;
  m.completionTokens += c;
  m.neurons += n;
}

function cloudflareBackend() {
  if (process.env.BLOG_CF_FALLBACK === "0") return "none";
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API_TOKEN)
    return "rest";
  if (process.env.TRANSLATE_SECRET) return "endpoint";
  return "none";
}

/** "mock", "nvidia", "nvidia+rest", "nvidia+endpoint", "rest", "endpoint" or "none". */
export function backend() {
  if (process.env.BLOG_AI_MOCK === "1") return "mock";
  const cf = cloudflareBackend();
  if (process.env.NVIDIA_API_KEY)
    return cf === "none" ? "nvidia" : `nvidia+${cf}`;
  return cf;
}

export function describeModels() {
  const cf = cloudflareBackend();
  const fmt = (role) =>
    [
      ...NVIDIA_MODELS[role].map((m) =>
        process.env.NVIDIA_API_KEY ? m : null,
      ),
      cf !== "none" ? CF_MODELS[role] : null,
    ]
      .filter(Boolean)
      .join(" > ");
  const perLocale = Object.keys(NVIDIA_TRANSLATE_BY_LOCALE)
    .map((l) =>
      `${l}: ${[
        ...(process.env.NVIDIA_API_KEY ? translateModelsFor(l) : []),
        cf !== "none" ? CF_MODELS.translate : null,
      ]
        .filter(Boolean)
        .join(" > ")}`,
    )
    .join("; ");
  return {
    text: fmt("text") || "(none)",
    translate: process.env.NVIDIA_API_KEY ? `[${perLocale}] concurrency=${NVIDIA_CONCURRENCY}` : fmt("translate") || "(none)",
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err?.fatal) break;
      console.log(
        `    ↻ ${label} attempt ${attempt} failed: ${err.message || err}`,
      );
      await sleep(2000 * attempt);
    }
  }
  throw last;
}

/** Reasoning models may wrap thoughts in <think> tags; keep only the answer. */
export function stripThinking(text) {
  return String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

const deadNvidiaModels = new Set();
// After this many consecutive calls where every NVIDIA model failed, stop waiting on NVIDIA for the run.
const NVIDIA_BREAKER = Number(process.env.BLOG_NVIDIA_BREAKER || 3);
let nvidiaConsecutiveFailures = 0;
let nextNvidiaSlot = 0;
let nvidiaCooldownUntil = 0;

/** One NVIDIA request, inside the shared limiter and spaced by NVIDIA_MIN_INTERVAL_MS. */
function nvidiaOnce(model, messages, max_tokens, temperature, timeoutMs = NVIDIA_TIMEOUT_MS) {
  return nvidiaLimiter.run(async () => {
    for (;;) {
      // Reserve synchronously, including the shared cooldown, to preserve spacing.
      const start = Math.max(Date.now(), nextNvidiaSlot, nvidiaCooldownUntil);
      nextNvidiaSlot = start + NVIDIA_MIN_INTERVAL_MS;
      const wait = start - Date.now();
      if (wait > 0) await sleep(wait);
      // An in-flight 429 may have extended the cooldown after reservation.
      if (Date.now() < nvidiaCooldownUntil) continue;
      return nvidiaRequest(model, messages, max_tokens, temperature, timeoutMs);
    }
  });
}

async function nvidiaRequest(model, messages, max_tokens, temperature, timeoutMs = NVIDIA_TIMEOUT_MS) {
  ledger.nvidia.calls += 1;
  let res;
  try {
    res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      // enable_thinking=false: Nemotron 3 models answer directly instead of spending tokens on reasoning.
      body: JSON.stringify({
        model,
        messages,
        max_tokens,
        temperature,
        ...(model.startsWith("nvidia/nemotron")
          ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    ledger.nvidia.timeouts += 1;
    const err = new Error(
      `NVIDIA ${model}: ${cause?.name === "TimeoutError" ? `timeout after ${timeoutMs / 1000}s` : cause?.message || cause}`,
    );
    err.retryable = true;
    err.timeout = cause?.name === "TimeoutError";
    throw err;
  }
  let raw;
  try {
    raw = await res.text();
  } catch (cause) {
    if (cause?.name !== "TimeoutError" && !cause?.timeout) throw cause;
    ledger.nvidia.timeouts += 1;
    const err = new Error(`NVIDIA ${model}: timeout reading response`);
    err.timeout = true;
    err.retryable = true;
    throw err;
  }
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const detail = (
      body.detail ||
      body.error?.message ||
      body.title ||
      raw ||
      ""
    )
      .toString()
      .replace(/Bearer\s+\S+/g, "Bearer ***")
      .slice(0, 160);
    const err = new Error(`NVIDIA ${model} HTTP ${res.status}: ${detail}`);
    err.status = res.status;
    if (res.status === 401 || res.status === 403) {
      err.auth = true;
    } else if (res.status === 429) {
      ledger.nvidia.rateLimited += 1;
      err.retryable = true;
      err.rateLimited = true;
      const header = res.headers.get("retry-after");
      const seconds = header === null ? NaN : Number(header);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
      if (Number.isFinite(delay) && delay > 0) {
        err.retryAfterMs = delay;
        nvidiaCooldownUntil = Math.max(nvidiaCooldownUntil, Date.now() + delay);
      }
    } else if (res.status >= 500 || res.status === 408) {
      ledger.nvidia.serverErrors += 1;
      err.retryable = true;
    } else if (res.status === 404 || res.status === 410) {
      err.unavailable = true;
    }
    throw err;
  }
  const choice = body.choices?.[0] ?? {};
  const text = stripThinking(choice.message?.content ?? "");
  if (!text) {
    const err = new Error(
      `NVIDIA ${model}: empty reply (finish_reason=${choice.finish_reason ?? "?"})`,
    );
    err.retryable = true;
    throw err;
  }
  record(
    model,
    body.usage,
    messages.reduce((n, m) => n + m.content.length, 0),
    text.length,
    "nvidia",
  );
  return { text, model };
}

/** Try each NVIDIA model for the role with backoff; throws the last error when all fail. */
async function chatNvidia(role, messages, max_tokens, temperature, locale) {
  const models =
    role === TRANSLATE_MODEL && locale
      ? translateModelsFor(locale)
      : (NVIDIA_MODELS[role] ?? [role]);
  let last = new Error("no NVIDIA model available");
  let allRateLimited = true;
  for (const [i, model] of models.entries()) {
    if (deadNvidiaModels.has(model)) continue;
    if (i > 0) ledger.nvidia.modelFallbacks += 1;
    for (let attempt = 0; attempt <= NVIDIA_BACKOFF_S.length; attempt += 1) {
      try {
        return await nvidiaOnce(model, messages, max_tokens, temperature);
      } catch (err) {
        last = err;
        if (!err.rateLimited) allRateLimited = false;
        if (err.auth) {
          err.fatalNvidia = true;
          throw err;
        }
        if (err.unavailable) {
          deadNvidiaModels.add(model);
          ledger.nvidia.unavailableModels.push(model);
          console.log(
            `    ⚠ ${err.message} — skipping this model for the rest of the run`,
          );
          break;
        }
        if (!err.retryable) break;
        // Rate limits get the full backoff ladder; overload/timeouts get two retries, then the next model.
        const maxAttempts = err.rateLimited ? NVIDIA_BACKOFF_S.length : 2;
        if (attempt >= maxAttempts) break;
        const delay = err.retryAfterMs ?? NVIDIA_BACKOFF_S[attempt] * 1000;
        console.log(
          `    ↻ ${err.message} — retry in ${Math.round(delay / 1000)}s`,
        );
        await sleep(delay);
      }
    }
  }
  last.allRateLimited = allRateLimited;
  throw last;
}

async function chatCloudflare(
  kind,
  model,
  messages,
  max_tokens,
  temperature,
  promptChars,
) {
  return withRetry(async () => {
    if (kind === "rest") {
      const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.CLOUDFLARE_AI_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ messages, max_tokens, temperature }),
        signal: AbortSignal.timeout(180_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) {
        const err = new Error(
          `Workers AI REST HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`,
        );
        if (res.status === 401 || res.status === 403) err.fatal = true;
        if (
          res.status === 429 ||
          /4006|neurons|daily free allocation/i.test(JSON.stringify(body))
        ) {
          err.fatal = true;
          err.quota = true;
        }
        throw err;
      }
      const result = body.result ?? {};
      const text =
        typeof result.response === "string"
          ? result.response
          : JSON.stringify(result.response ?? "");
      record(model, result.usage, promptChars, text.length);
      return { text, model };
    }
    const url =
      process.env.BLOG_AI_URL || "https://sundayatlastravel.com/api/blog-ai";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-translate-secret": process.env.TRANSLATE_SECRET,
      },
      body: JSON.stringify({ model, messages, max_tokens, temperature }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        `/api/blog-ai HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`,
      );
      if (res.status === 401 || res.status === 404 || res.status === 503)
        err.fatal = true;
      if (res.status === 429) {
        err.fatal = true;
        err.quota = true;
      }
      throw err;
    }
    record(
      body.model || model,
      body.usage,
      promptChars,
      String(body.response ?? "").length,
    );
    return { text: String(body.response ?? ""), model: body.model || model };
  }, `chat ${model}`);
}

/**
 * Chat completion. `model` is a role ("text" / "translate") or an explicit model id
 * (an "@cf/..." id goes straight to Workers AI; anything else straight to NVIDIA).
 * Returns { text, model } where model is the id that actually answered.
 */
export async function chat({
  model = TEXT_MODEL,
  messages,
  max_tokens = 2048,
  temperature = 0.6,
  mock,
  locale,
}) {
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  const role = model === TEXT_MODEL || model === TRANSLATE_MODEL ? model : null;
  if (process.env.BLOG_AI_MOCK === "1") {
    const text = typeof mock === "function" ? mock(messages) : "{}";
    record(
      role ? (NVIDIA_MODELS[role][0] ?? model) : model,
      null,
      promptChars,
      text.length,
      "mock",
    );
    return { text, model };
  }
  const cf = cloudflareBackend();
  const isCf = !role && model.startsWith("@cf/");
  let nvidiaErr = null;
  if (
    process.env.NVIDIA_API_KEY &&
    !isCf &&
    nvidiaConsecutiveFailures < NVIDIA_BREAKER
  ) {
    try {
      const out = await chatNvidia(
        role ?? model,
        messages,
        max_tokens,
        temperature,
        locale,
      );
      nvidiaConsecutiveFailures = 0;
      return out;
    } catch (err) {
      nvidiaErr = err;
      nvidiaConsecutiveFailures += 1;
      if (nvidiaConsecutiveFailures >= NVIDIA_BREAKER)
        console.log(
          `    ⚠ NVIDIA failed ${NVIDIA_BREAKER} calls in a row; not retrying it for the rest of this run`,
        );
      if (cf === "none" || !role) {
        // Persistent NVIDIA rate limiting: stop the run gracefully (queue + report still written).
        err.fatal = Boolean(err.fatalNvidia || err.allRateLimited);
        err.quota = Boolean(err.allRateLimited);
        throw err;
      }
      ledger.nvidia.cloudflareFallbacks += 1;
      console.log(
        `    ⚠ NVIDIA failed for ${role} (${err.message}); last-resort fallback to Workers AI`,
      );
    }
  }
  if (cf === "none") {
    const err = new Error(
      "No AI credentials: set NVIDIA_API_KEY (preferred), or TRANSLATE_SECRET / CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_API_TOKEN for Workers AI, or BLOG_AI_MOCK=1 for a dry run.",
    );
    err.fatal = true;
    throw err;
  }
  const cfModel = role ? CF_MODELS[role] : model;
  try {
    return await chatCloudflare(
      cf,
      cfModel,
      messages,
      max_tokens,
      temperature,
      promptChars,
    );
  } catch (err) {
    if (nvidiaErr)
      err.message = `${err.message} (after NVIDIA: ${nvidiaErr.message})`;
    throw err;
  }
}

/** flux-1-schnell image. Returns base64 JPEG or null. */
export async function image(prompt) {
  if (process.env.BLOG_AI_MOCK === "1") return null;
  const kind = cloudflareBackend();
  if (kind === "none") return null;
  return withRetry(async () => {
    ledger.images += 1;
    if (kind === "rest") {
      const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${IMAGE_MODEL}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.CLOUDFLARE_AI_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt, steps: 4 }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`flux HTTP ${res.status}`);
      return body.result?.image ?? null;
    }
    const url =
      process.env.BLOG_AI_URL || "https://sundayatlastravel.com/api/blog-ai";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-translate-secret": process.env.TRANSLATE_SECRET,
      },
      body: JSON.stringify({ task: "image", prompt, steps: 4 }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`/api/blog-ai image HTTP ${res.status}`);
    return body.image ?? null;
  }, "image");
}

/** First JSON object in a model reply (tolerates ```json fences and chatter). */
export function parseJsonObject(text) {
  let source = String(text || "").trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) source = fenced[1];
  const start = source.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export const M2M_MODEL = "@cf/meta/m2m100-1.2b";

/**
 * Last-resort machine translation of ONE field with Workers AI m2m100 (very cheap in neurons).
 * Returns the translated text, or null when Workers AI is not configured or the call fails.
 */
export async function translateM2M(text, targetLang) {
  if (process.env.BLOG_AI_MOCK === "1") return null;
  const cf = cloudflareBackend();
  if (cf === "none") return null;
  const src = String(text ?? "").trim();
  if (!src || src.length > 4000) return null;
  try {
    let out = null;
    if (cf === "rest") {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${M2M_MODEL}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.CLOUDFLARE_AI_API_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: src, source_lang: "en", target_lang: targetLang }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success !== false) out = body.result?.translated_text ?? null;
    } else {
      const res = await fetch(process.env.BLOG_AI_URL || "https://sundayatlastravel.com/api/blog-ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-translate-secret": process.env.TRANSLATE_SECRET,
        },
        body: JSON.stringify({ task: "m2m", text: src, target_lang: targetLang }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) out = typeof body.response === "string" ? body.response : null;
    }
    if (typeof out !== "string" || !out.trim()) return null;
    record(M2M_MODEL, null, src.length, out.length);
    return out.trim();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ vision */

export const VISION_MODELS = visionModels();
export const VISION_MODEL = VISION_MODELS[0];

/**
 * One vision-language call on the NVIDIA API (same key, same limiter and spacing
 * as text calls). `imageDataUrl` is a `data:image/jpeg;base64,...` string.
 * Returns the reply text; throws when NVIDIA_API_KEY is missing or every retry fails.
 */
export async function vision(prompt, imageDataUrl, { model, max_tokens = 200 } = {}) {
  if (!process.env.NVIDIA_API_KEY) {
    const err = new Error("NVIDIA_API_KEY missing");
    err.fatal = true;
    throw err;
  }
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
  // Short timeout: a hung vision call must not stall the run; the gate fails closed and retries next time.
  const res = await runVisionModels(model ? [model] : VISION_MODELS,
    candidate => nvidiaOnce(candidate, messages, max_tokens, 0, VISION_TIMEOUT_MS));
  return res.text;
}
