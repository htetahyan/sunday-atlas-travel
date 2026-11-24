#!/usr/bin/env node
/**
 * Simplified Chinese (zh) queue: translates ONE item per run (a static page, a destination or a
 * tour) from English and writes the zh fields to Sanity and to content/. The zh-translate GitHub
 * workflow runs this every 3 hours, then deploys, so /zh/ grows one page at a time.
 *
 * Queue order (first match wins):
 *   1. static pages (about, faq, ...) that have no zh yet
 *   2. destinations without zh (most tours first)
 *   3. tours without zh whose countries all have zh (if a country is missing, it goes first)
 *   4. items whose English changed since their zh was written (re-translated)
 * An item that fails validation 3 times is skipped and reported; fix its English or write the zh
 * by hand in Sanity.
 *
 * A destination or tour is live in zh when name/title.zh and summary.zh are set. They are written
 * together with every other zh field in one Sanity transaction, only after every string passed
 * validation, so a half-translated page never appears.
 *
 * Never translated or touched: slugs, prices, numbers, images, private supplier fields.
 *
 *   node scripts/zh-translate-next.mjs                 # next item in the queue
 *   node scripts/zh-translate-next.mjs --slug=armenia  # a given item (destination, tour or page id)
 *   node scripts/zh-translate-next.mjs --status        # print the queue and the estimate, no change
 *   node scripts/zh-translate-next.mjs --dry-run       # translate, print, write nothing
 *   node scripts/zh-translate-next.mjs --no-sanity     # write content/ only (local testing)
 *   node scripts/zh-translate-next.mjs --catch-up      # 0-2 items by time since the last one (~1 per 3 h)
 *
 * Env: NVIDIA_API_KEY (free API), Workers AI fallback via TRANSLATE_SECRET or CLOUDFLARE_*,
 * SANITY_API_WRITE_TOKEN for the CMS write. Writes $GITHUB_OUTPUT `translated`, `url`, `remaining`.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { translateStrings, zhKeywords } from "./lib/zh-core.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CONTENT = join(ROOT, "content");
const STATUS_FILE = join(CONTENT, "zh-status.json");
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://sundayatlastravel.com").replace(/\/$/, "");
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || process.env.SANITY_PROJECT_ID || "mi09tcmc";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || process.env.SANITY_DATASET || "production";
const token = (process.env.SANITY_API_WRITE_TOKEN || process.env.SANITY_API_TOKEN || "").trim();
const RUN_EVERY_HOURS = 3;
const MAX_FAILURES = 3;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const dryRun = Boolean(args["dry-run"]);
const useSanity = !args["no-sanity"];

const LOC = new Set(["en", "de", "fr", "ja", "es", "zh"]);
const PRIVATE_KEYS = new Set(["supplier", "suppliers", "supplierName", "supplierContact", "supplierPriceRule"]);
const SKIP_KEYS = new Set(["slug", "pageId", "settingKey"]);
/** Only these static pages exist in zh (blog is not offered in zh). */
const ZH_PAGES = ["home", "about", "contact", "faq", "how-it-works", "privacy", "terms", "destinations", "packages"];
const SANITY_TYPE = { destinations: "destination", packages: "travelPackage", pages: "staticPage" };

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const publicKeys = (node) => Object.keys(node).filter((k) => !k.startsWith("_"));

function isLocalized(node) {
  if (!isObj(node)) return false;
  const keys = publicKeys(node);
  if (!keys.length || !keys.every((k) => LOC.has(k)) || !("en" in node)) return false;
  return typeof node.en === "string" || (Array.isArray(node.en) && node.en.every((s) => typeof s === "string"));
}
function isSeo(node) {
  if (!isObj(node)) return false;
  const keys = publicKeys(node);
  return keys.length > 0 && keys.every((k) => LOC.has(k)) && isObj(node.en) && ("seo_title" in node.en || "meta_description" in node.en);
}

/** Localized text nodes and SEO blocks, with stable paths (array indexes). */
function collect(doc, folder) {
  const fields = [];
  const seos = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (!isObj(node)) return;
    if (isSeo(node)) return seos.push({ path, node });
    if (isLocalized(node)) return fields.push({ path, node });
    for (const key of Object.keys(node)) {
      if (key.startsWith("_") || PRIVATE_KEYS.has(key) || SKIP_KEYS.has(key)) continue;
      if (!path && key === "headings" && folder === "packages") continue; // from the dictionaries
      walk(node[key], path ? `${path}.${key}` : key);
    }
  };
  walk(doc, "");
  return { fields, seos };
}

function englishSnapshot(doc, folder) {
  const { fields, seos } = collect(doc, folder);
  return hash([
    fields.map((f) => [f.path, f.node.en]),
    seos.map((s) => [s.path, s.node.en?.seo_title ?? "", s.node.en?.meta_description ?? ""]),
  ]);
}

function hasText(v) {
  return typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) && v.some((s) => String(s).trim());
}

function loadStatus() {
  if (!existsSync(STATUS_FILE)) return { items: {}, failures: {} };
  const s = readJson(STATUS_FILE);
  return { items: s.items ?? {}, failures: s.failures ?? {} };
}

function loadItems() {
  const items = [];
  for (const folder of ["pages", "destinations", "packages"]) {
    const dir = join(CONTENT, folder);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const id = file.replace(/\.json$/, "");
      if (folder === "pages" && !ZH_PAGES.includes(id)) continue;
      const doc = readJson(join(dir, file));
      if (doc.published === false || doc.draft === true) continue;
      items.push({ key: `${folder}/${id}`, folder, id, file: join(dir, file), doc });
    }
  }
  return items;
}

function isLive(item, status) {
  if (item.folder === "pages") return Boolean(status.items[item.key]);
  const nameField = item.folder === "destinations" ? item.doc.name : item.doc.title;
  return hasText(nameField?.zh) && hasText(item.doc.summary?.zh);
}

function countriesOf(pkg) {
  const list = [pkg.destination, ...(Array.isArray(pkg.countries) ? pkg.countries : [])];
  return [...new Set(list.filter((s) => typeof s === "string" && s))];
}

function zhUrl(item) {
  if (item.folder === "destinations") return `${SITE}/zh/destinations/${item.id}/`;
  if (item.folder === "packages") return `${SITE}/zh/packages/${item.id}/`;
  return item.id === "home" ? `${SITE}/zh/` : `${SITE}/zh/${item.id}/`;
}

/** Ordered list of items still needing zh (missing first, then stale). */
function buildQueue(items, status) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const tourCount = new Map();
  for (const it of items.filter((i) => i.folder === "packages")) {
    for (const c of countriesOf(it.doc)) tourCount.set(c, (tourCount.get(c) ?? 0) + 1);
  }
  const blocked = (it) => (status.failures[it.key] ?? 0) >= MAX_FAILURES;
  const missing = items.filter((it) => !isLive(it, status) && !blocked(it));
  const pages = missing.filter((i) => i.folder === "pages");
  const dests = missing
    .filter((i) => i.folder === "destinations")
    .sort((a, b) => (tourCount.get(b.id) ?? 0) - (tourCount.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const destRank = new Map(dests.map((d, i) => [d.id, i]));
  const tours = missing
    .filter((i) => i.folder === "packages")
    .sort(
      (a, b) =>
        (destRank.get(a.doc.destination) ?? -1) - (destRank.get(b.doc.destination) ?? -1) ||
        a.id.localeCompare(b.id),
    );
  const stale = items.filter(
    (it) =>
      isLive(it, status) &&
      !blocked(it) &&
      status.items[it.key]?.source &&
      status.items[it.key].source !== englishSnapshot(it.doc, it.folder),
  );
  const queue = [...pages, ...dests, ...tours, ...stale];
  return { queue, byKey, blocked: items.filter(blocked) };
}

/** The item to translate now; a tour whose country lacks zh yields that destination instead. */
function pickNext(queue, byKey, status) {
  const first = queue[0];
  if (!first || first.folder !== "packages") return first;
  for (const c of countriesOf(first.doc)) {
    const dest = byKey.get(`destinations/${c}`);
    if (dest && !isLive(dest, status) && (status.failures[dest.key] ?? 0) < MAX_FAILURES) return dest;
  }
  return first;
}

const BRAND_RE = /Sunday Atlas Travel|Sunday Atlas/g;
function needsModel(text) {
  return /[A-Za-z]{3,}/.test(String(text).replace(BRAND_RE, "").replace(/\{[^{}]+\}|https?:\/\/\S+/g, ""));
}

function setPath(root, path, value) {
  const parts = [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]));
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (node == null) return false;
    node = node[parts[i]];
  }
  if (node == null || typeof node !== "object") return false;
  node[parts[parts.length - 1]] = value;
  return true;
}
function getPath(root, path) {
  const parts = [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]));
  return parts.reduce((n, p) => (n == null ? undefined : n[p]), root);
}

/** Translate every localized field of `doc` into zh. Returns { values: Map<path, zhNode>, failed, models }. */
async function translateDoc(doc, folder, label) {
  const collected = collect(doc, folder);
  const { fields } = collected;
  // Site pages: an existing zh SEO block is kept. It is written without tour/destination counts
  // (the English counts cover the whole catalog, zh lists show only zh items), and the number
  // check would put the counts back on a re-translation.
  const seos = folder === "pages" ? collected.seos.filter((s) => !s.node.zh?.seo_title) : collected.seos;
  const strings = [];
  const copied = new Map();
  for (const f of fields) {
    const en = f.node.en;
    const list = Array.isArray(en) ? en : [en];
    list.forEach((text, i) => {
      const id = Array.isArray(en) ? `${f.path}#${i}` : f.path;
      if (!String(text).trim()) copied.set(id, text);
      else if (!needsModel(text)) copied.set(id, text);
      else strings.push({ id, text });
    });
  }
  for (const s of seos) {
    for (const key of ["seo_title", "meta_description"]) {
      const text = s.node.en?.[key];
      if (typeof text === "string" && text.trim()) strings.push({ id: `${s.path}.zh.${key}`, text });
    }
  }
  const context = `${folder === "packages" ? "Tour page" : folder === "destinations" ? "Destination page" : "Website page"}: ${label}`;
  console.log(`[zh] ${strings.length} string(s) to translate, ${copied.size} copied as is`);
  const { done, failed, models } = await translateStrings(strings, { context });
  const result = (id) => (done.has(id) ? done.get(id) : copied.get(id));

  const values = new Map();
  for (const f of fields) {
    const en = f.node.en;
    if (Array.isArray(en)) {
      const out = en.map((_, i) => result(`${f.path}#${i}`));
      if (out.every((v) => v !== undefined)) values.set(`${f.path}.zh`, out);
    } else if (result(f.path) !== undefined) {
      values.set(`${f.path}.zh`, result(f.path));
    }
  }
  for (const s of seos) {
    const en = s.node.en ?? {};
    const title = done.get(`${s.path}.zh.seo_title`) ?? "";
    const description = done.get(`${s.path}.zh.meta_description`) ?? "";
    const summary = [en.seo_title, en.meta_description].filter(Boolean).join(". ");
    const keywords = summary && !dryRun ? await zhKeywords("k", summary, context) : [];
    values.set(`${s.path}.zh`, {
      seo_title: title,
      meta_description: description,
      focus_keyword: keywords[0] ?? "",
      keywords,
      og_image: typeof en.og_image === "string" ? en.og_image : "",
      canonical: "",
      noindex: en.noindex === true,
    });
  }
  return { values, failed, models, total: strings.length };
}

async function sanity(path, init = {}) {
  const res = await fetch(`https://${projectId}.api.sanity.io/v2024-01-01/${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sanity HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function fetchSanityDocs(item) {
  const type = SANITY_TYPE[item.folder];
  const field = item.folder === "pages" ? "pageId" : "slug";
  const q = `*[_type == $type && ${field} == $id]`;
  const url = `data/query/${dataset}?query=${encodeURIComponent(q)}&%24type=${encodeURIComponent(JSON.stringify(type))}&%24id=${encodeURIComponent(JSON.stringify(item.id))}&perspective=raw`;
  const { result } = await sanity(url);
  return Array.isArray(result) ? result : [];
}

/** Sanity keeps `_type` / `_key` on nested objects; content/ does not. */
function withoutMeta(value) {
  if (Array.isArray(value)) return value.map(withoutMeta);
  if (!isObj(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !k.startsWith("_"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, withoutMeta(v)]),
  );
}

/** Apply `values` to every Sanity copy of the item (published and draft) in one transaction. */
async function writeSanity(item, values) {
  const docs = await fetchSanityDocs(item);
  if (docs.length === 0) throw new Error(`no Sanity document for ${item.key}`);
  const mutations = [];
  for (const doc of docs) {
    const set = {};
    for (const [path, value] of values) {
      const enPath = path.replace(/\.zh$/, ".en");
      const local = getPath(item.doc, enPath);
      const remote = getPath(doc, enPath);
      if (JSON.stringify(withoutMeta(local)) !== JSON.stringify(withoutMeta(remote))) {
        throw new Error(`${doc._id}: English at ${enPath} differs from content/ (run cms:pull first)`);
      }
      set[path] = value;
    }
    mutations.push({ patch: { id: doc._id, ifRevisionID: doc._rev, set } });
  }
  await sanity(`data/mutate/${dataset}?returnIds=true&visibility=sync`, {
    method: "POST",
    body: JSON.stringify({ mutations }),
  });
  return docs.map((d) => d._id);
}

function estimate(remaining) {
  if (remaining <= 0) return "";
  const now = new Date();
  // Runs at :37 every 3 hours UTC (00:37, 03:37, ...).
  const next = new Date(now);
  next.setUTCMinutes(37, 0, 0);
  while (next <= now || next.getUTCHours() % RUN_EVERY_HOURS !== 0) next.setTime(next.getTime() + 3600e3);
  const finish = new Date(next.getTime() + (remaining - 1) * RUN_EVERY_HOURS * 3600e3);
  return finish.toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" }) + " (Asia/Dubai)";
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(""));
}

async function main() {
  const status = loadStatus();
  const items = loadItems();
  const { queue, byKey, blocked } = buildQueue(items, status);
  const live = items.filter((i) => isLive(i, status)).length;

  if (args.status) {
    console.log(`[zh] ${live}/${items.length} items have zh; ${queue.length} queued; ${blocked.length} skipped after failures.`);
    queue.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}. ${it.key}`));
    blocked.forEach((it) => console.log(`  ✗ ${it.key} (failed ${status.failures[it.key]}x)`));
    if (queue.length) console.log(`[zh] estimated finish: ${estimate(queue.length)}`);
    return;
  }

  // --catch-up (scheduled runs, and the blog job's dispatch): keep ~1 item per 3 hours even when
  // GitHub skips a cron slot (3 Nov: only the 01:11 UTC run of the 8 fired). 0 items if the last
  // one is under 2.5 h old, 1 if under 5.5 h, otherwise 2 (catching up one skipped slot per run).
  let want = 1;
  if (args["catch-up"] && typeof args.slug !== "string") {
    const last = Math.max(0, ...Object.values(status.items).map((x) => Date.parse(x.translatedAt ?? "") || 0));
    const hours = (Date.now() - last) / 3600000;
    want = hours < 2.5 ? 0 : hours < 5.5 ? 1 : 2;
    console.log(`[zh] catch-up: last item ${hours.toFixed(1)} h ago -> ${want} item(s) this run`);
    if (!want) {
      output({ translated: "false", remaining: String(queue.length) });
      return;
    }
  }
  const done = [];
  for (let n = 0; n < want; n += 1) {
    const r = await translateNext(n === 0 ? null : buildQueue(loadItems(), status), status, live);
    if (!r) break;
    if (r.item) done.push(r);
    if (!r.ok) break;
  }
  const ok = done.filter((r) => r.ok);
  const after = buildQueue(loadItems(), status).queue.length;
  if (ok.length) {
    console.log(`[zh] ${after} item(s) left${after ? `; estimated finish ${estimate(after)}` : " — all done"}.`);
    output({ translated: "true", url: ok[0].url, item: ok.map((r) => r.item).join(", "), remaining: String(after) });
  } else if (!dryRun) {
    output({ translated: "false", remaining: String(after) });
  }
}

/** Translate one item (the next in the queue, or --slug on the first call). Returns null when the queue is empty. */
async function translateNext(fresh, status, live) {
  const items = loadItems();
  const { queue, byKey, blocked } = fresh ?? buildQueue(items, status);
  let item;
  if (typeof args.slug === "string" && !fresh) {
    item = items.find((i) => i.id === args.slug || i.key === args.slug);
    if (!item) throw new Error(`no item "${args.slug}"`);
  } else {
    item = pickNext(queue, byKey, status);
  }
  if (!item) {
    console.log(`✓ [zh] every item has zh (${live}/${items.length}). Nothing to do.`);
    if (blocked.length) console.log(`::warning::zh skipped after failures: ${blocked.map((b) => b.key).join(", ")}`);
    return null;
  }

  const label =
    item.folder === "packages" ? item.doc.title?.en : item.folder === "destinations" ? item.doc.name?.en : item.id;
  console.log(`[zh] translating ${item.key} (${label})`);
  const { values, failed, models, total } = await translateDoc(item.doc, item.folder, label);
  console.log(`[zh] ${total - failed.length}/${total} string(s) passed (models: ${models.join(", ") || "none"})`);

  if (failed.length > 0) {
    if (!dryRun) {
      status.failures[item.key] = (status.failures[item.key] ?? 0) + 1;
      writeJson(STATUS_FILE, status);
    }
    console.log(`::warning::zh ${item.key}: ${failed.length} string(s) failed validation; nothing published (attempt ${status.failures[item.key] ?? 1}/${MAX_FAILURES}).`);
    return { ok: false, item: null };
  }

  if (dryRun) {
    for (const [path, value] of values) console.log(`  ${path}: ${JSON.stringify(value).slice(0, 160)}`);
    console.log(`[zh] dry run: nothing written.`);
    return { ok: false, item: null };
  }

  if (useSanity) {
    if (!token) throw new Error("SANITY_API_WRITE_TOKEN is not set (use --no-sanity for a local test)");
    const ids = await writeSanity(item, values);
    console.log(`✓ [zh] Sanity updated: ${ids.join(", ")}`);
  }
  for (const [path, value] of values) setPath(item.doc, path.replace(/\.zh$/, ""), { ...getPath(item.doc, path.replace(/\.zh$/, "")), zh: value });
  writeJson(item.file, item.doc);
  status.items[item.key] = {
    source: englishSnapshot(item.doc, item.folder),
    translatedAt: new Date().toISOString(),
    models,
  };
  delete status.failures[item.key];
  writeJson(STATUS_FILE, status);
  console.log(`✓ [zh] ${item.key} → ${zhUrl(item)}`);
  return { ok: true, item: item.key, url: zhUrl(item) };
}

main().catch((err) => {
  console.error("❌ [zh]", err.message || err);
  process.exit(1);
});
