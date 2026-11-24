/**
 * Shared helpers for the blog freshness pipeline:
 *   scripts/blog-refresh.mjs  (catalog price/duration refresh + honest updatedAt)
 *   scripts/blog-daily.mjs    (1 new post per Asia/Dubai day + seasonal refresh of the oldest posts)
 *   scripts/sanity-push-blog.mjs
 *
 * Date rule: `updatedAt` only moves when the post's content hash changes.
 * Nothing here ever stamps "today" on a post whose content is identical.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_RE, LOCALES, hashCanonical } from "./auto-translate-core.mjs";

export { LOCALES };
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONTENT_DIR = join(ROOT, "content");
export const BLOG_DIR = join(CONTENT_DIR, "blog");
export const PACKAGES_DIR = join(CONTENT_DIR, "packages");
export const DEST_DIR = join(CONTENT_DIR, "destinations");
export const QUEUE_FILE = join(CONTENT_DIR, "blog-topic-queue.json");
export const SITE_ORIGIN = "https://sundayatlastravel.com";
export const TIME_ZONE = "Asia/Dubai";

/** Words the brand never uses. */
export const BANNED_RE =
  /tailor[\s-]*made|bespoke|curated|ma(?:ß|ss)geschneidert|sur[\s-]mesure|a\s+medida(?!\s+que(?![\p{L}]))|オーダーメイド|テーラーメイド|厳選/iu;

/**
 * Third-party brands, booking platforms and private supplier names loaded from
 * the SUPPLIER_EXTRA_RE environment variable and/or a names file
 * (SUPPLIER_NAMES_FILE, or content/private/supplier-names.txt). A missing file
 * adds nothing. These names must never appear in public copy.
 */
const PUBLIC_SUPPLIER_RE =
  /klook|getyourguide|get\s+your\s+guide|viator|tripadvisor|trip\.com|booking\.com|expedia|\bagoda|airbnb|kiwitaxi|stantours|silk\s*road\s*destinations|12go|tourradar|intrepid|g\s?adventures/iu;

function supplierExtraFragments() {
  const parts = [];
  const fromEnv = process.env.SUPPLIER_EXTRA_RE;
  if (fromEnv) {
    for (const frag of fromEnv.split(/[|\n]/)) {
      const text = frag.trim();
      if (text) parts.push(text);
    }
  }
  const file = process.env.SUPPLIER_NAMES_FILE || join(ROOT, "content", "private", "supplier-names.txt");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const text = line.trim();
      if (!text || text.startsWith("#")) continue;
      parts.push(text);
    }
  }
  for (const frag of parts) {
    try {
      new RegExp(frag, "iu");
    } catch (err) {
      throw new Error(`Invalid supplier name fragment: ${frag} (${err.message})`);
    }
  }
  return parts;
}

export const SUPPLIER_RE = new RegExp(
  [PUBLIC_SUPPLIER_RE.source, ...supplierExtraFragments()].join("|"),
  "iu",
);

const FR_DETERMINERS = new Set(
  "un une des les le la l de d du par aucun aucune sans notre nos votre vos leur leurs ce cet cette ces quel quelle via".split(" "),
);
/**
 * Text with harmless look-alikes of reseller words removed, before BRAND_RE runs:
 *   - fractions: "les deux tiers", "un tiers du trajet", "le premier tiers";
 *   - adjectival French "intermédiaire" after a noun ("saisons intermédiaires", "polaire
 *     intermédiaire", "niveau intermédiaire"); a noun use after a determiner ("un intermédiaire",
 *     "par l'intermédiaire") is still rejected.
 * Case, curly apostrophes and non-breaking spaces are normalised first.
 */
export function brandNeutral(value) {
  let t = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u00A0\u202F\u2009]/g, " ")
    .replace(/\s+/g, " ");
  t = t.replace(
    /(?<![\p{L}])(?:(?:un|deux|trois|quatre)\s+tiers|(?:le|au|du|d'un|premier|dernier|second)\s+tiers(?=\s+(?:du|de|des|d')))(?![\p{L}])/giu,
    " ",
  );
  t = t.replace(
    /(?<![\p{L}'])(\p{L}+)(\s+|-)(interm[ée]diaires?)(?![\p{L}])/giu,
    (m, word) => (FR_DETERMINERS.has(word.toLowerCase()) ? m : word),
  );
  return t;
}

/* ------------------------------------------------------------------ dates */

/** ISO 8601 timestamp with the +04:00 offset (Asia/Dubai has no DST). */
export function nowIso(date = new Date()) {
  const shifted = new Date(date.getTime() + 4 * 3600 * 1000);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "+04:00");
}

/** YYYY-MM-DD in Asia/Dubai. */
export function todayDate(date = new Date()) {
  return nowIso(date).slice(0, 10);
}

/** Comparable epoch ms for a `YYYY-MM-DD` or full ISO value. Date-only means 08:00 Dubai. */
export function dateValue(value) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const v = value.trim();
  const iso = /T/.test(v) ? v : `${v}T08:00:00+04:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/* ------------------------------------------------------------------ files */

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function listBlogFiles() {
  if (!existsSync(BLOG_DIR)) return [];
  return readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(BLOG_DIR, f));
}

export function loadPosts() {
  return listBlogFiles().map((file) => ({ file, post: readJson(file) }));
}

/** Published packages with a numeric priceFrom: the only allowed source of prices. */
export function loadCatalog() {
  const packages = new Map();
  for (const f of readdirSync(PACKAGES_DIR).filter((x) => x.endsWith(".json")).sort()) {
    const p = readJson(join(PACKAGES_DIR, f));
    if (!p || !p.slug) continue;
    const validPrices = new Set();
    if (typeof p.priceFrom === "number") validPrices.add(p.priceFrom);
    for (const row of p.priceTable?.rows ?? []) {
      for (const price of row?.prices ?? []) if (typeof price === "number") validPrices.add(price);
    }
    packages.set(p.slug, { ...p, validPrices });
  }
  const destinations = new Map();
  for (const f of readdirSync(DEST_DIR).filter((x) => x.endsWith(".json")).sort()) {
    const d = readJson(join(DEST_DIR, f));
    if (d && d.slug) destinations.set(d.slug, d);
  }
  const allPrices = new Set();
  for (const p of packages.values()) {
    if (p.published === false) continue;
    for (const v of p.validPrices) allPrices.add(v);
  }
  return { packages, destinations, allPrices };
}

export function isLivePackage(pkg) {
  return Boolean(pkg && pkg.published !== false && typeof pkg.priceFrom === "number");
}

/** Published package with no price at all: shown as "Price on request" on the site. */
export function isPriceOnRequest(pkg) {
  return Boolean(pkg && pkg.published !== false && pkg.priceFrom == null && !(pkg.priceTable?.rows ?? []).length);
}

/**
 * A package a blog post may link or embed: live with a catalog price, or published and price on
 * request (never state a price for those; there is none in the catalog to state).
 */
export function isLinkablePackage(pkg) {
  return isLivePackage(pkg) || isPriceOnRequest(pkg);
}

/* ------------------------------------------------------------------ hashing */

const META_KEYS = new Set(["publishedAt", "updatedAt", "contentHash", "featured", "published", "readingTimeMinutes", "refreshLog"]);

/** Hash of everything a reader sees. Dates and bookkeeping fields are excluded. */
export function contentHash(post) {
  const copy = {};
  for (const [k, v] of Object.entries(post)) if (!META_KEYS.has(k)) copy[k] = v;
  return hashCanonical(copy).slice(0, 16);
}

/**
 * Compare a post before and after an edit. Bumps `updatedAt` only when the
 * visible content really changed (or when it had already changed elsewhere,
 * e.g. in Sanity, without the stored hash being updated).
 * Returns true when the date moved.
 */
export function finalizeDates(before, after, { now = nowIso(), reason = "" } = {}) {
  const hBefore = contentHash(before);
  const hAfter = contentHash(after);
  const stored = typeof before.contentHash === "string" ? before.contentHash : "";
  const editedElsewhere = stored !== "" && stored !== hBefore;
  const changed = hBefore !== hAfter || editedElsewhere;
  after.contentHash = hAfter;
  if (changed) {
    after.updatedAt = now;
    after.readingTimeMinutes = readingMinutes(after);
    if (reason) {
      const log = Array.isArray(after.refreshLog) ? after.refreshLog : [];
      after.refreshLog = [...log, { at: now, reason }].slice(-10);
    }
  }
  return changed;
}

/* ------------------------------------------------------------------ text */

/** Visit every string in a value with its path. */
export function walkStrings(value, visit, path = []) {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkStrings(item, visit, [...path, i]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walkStrings(v, visit, [...path, k]);
  }
}

export function getAt(obj, path) {
  return path.reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

export function setAt(obj, path, value) {
  const parent = getAt(obj, path.slice(0, -1));
  if (parent != null) parent[path[path.length - 1]] = value;
}

export function countWords(text) {
  return String(text || "")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** English body words: intro, section paragraphs and highlights, FAQ answers. */
export function englishWordCount(post) {
  let n = countWords(post.intro?.en);
  for (const s of post.sections ?? []) {
    for (const p of s.paragraphs?.en ?? []) n += countWords(p);
    for (const h of s.highlights?.en ?? []) n += countWords(h);
  }
  for (const f of post.faqs ?? []) n += countWords(f.a?.en);
  return n;
}

export function readingMinutes(post) {
  return Math.max(4, Math.round(englishWordCount(post) / 220));
}

/* ------------------------------------------------------------------ prices */

const CUR_BEFORE = "(?:US\\s?\\$|\\$|USD|US-Dollar|dólares|dollars?|ドル|米ドル)";
const CUR_AFTER = "(?:USD|US\\$|\\$|US-Dollar|dollars?|dólares(?:\\s+estadounidenses)?|dollars\\s+américains|ドル|米ドル)";
const NUM = "\\d{1,3}(?:[,.\\u00A0\\u202F\\u2009' ]\\d{3})+|\\d+";
const PRICE_RE = new RegExp(
  `(${CUR_BEFORE})\\s?(${NUM})(?![\\d])|(?<![\\d.,])(${NUM})\\s?(${CUR_AFTER})`,
  "giu",
);

export function parseAmount(token) {
  return Number(String(token).replace(/[,.\u00A0\u202F\u2009' ]/g, ""));
}

/** Every currency amount in a string: [{ value, index, length, numText, numIndex }]. */
export function findPrices(text) {
  const out = [];
  const source = String(text || "");
  PRICE_RE.lastIndex = 0;
  let m;
  while ((m = PRICE_RE.exec(source))) {
    const numText = m[2] ?? m[3];
    const numIndex = m[2] != null ? m.index + m[0].indexOf(m[2], m[1].length) : m.index;
    out.push({ value: parseAmount(numText), index: m.index, length: m[0].length, numText, numIndex });
  }
  return out;
}

/** Format `value` with the same thousands separator the old token used. */
export function formatLike(oldToken, value) {
  const sep = String(oldToken).match(/\d([,.\u00A0\u202F\u2009' ])\d{3}/)?.[1];
  const digits = String(Math.round(value));
  if (!sep || digits.length <= 3) return digits;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/* ------------------------------------------------------------------ compliance */

/** All problems with wording in a post (any locale). */
export function wordingProblems(post) {
  const problems = [];
  walkStrings(post, (text, path) => {
    const key = path.join(".");
    if (/^(heroImage|sections\.\d+\.image)\.src$/.test(key) || key === "contentHash") return;
    if (BANNED_RE.test(text)) problems.push(`banned word at ${key}: "${text.match(BANNED_RE)[0]}"`);
    if (SUPPLIER_RE.test(text)) problems.push(`third-party name at ${key}: "${text.match(SUPPLIER_RE)[0]}"`);
    BRAND_RE.lastIndex = 0;
    if (BRAND_RE.test(brandNeutral(text))) problems.push(`reseller wording at ${key}`);
    BRAND_RE.lastIndex = 0;
  });
  return problems;
}

/** Currency amounts that are not real catalog prices. */
export function inventedPrices(post, catalog) {
  const problems = [];
  walkStrings(post, (text, path) => {
    for (const p of findPrices(text)) {
      if (!catalog.allPrices.has(p.value)) problems.push(`price ${p.numText} at ${path.join(".")} is not in the package catalog`);
    }
  });
  return problems;
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

const STOP = new Set("a an and the to in of for from by with on at by best top things do guide travel trip day days itinerary how what when where visit place places your".split(" "));
export function topicTokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)),
  );
}

export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/* ------------------------------------------------------------ duplicate-topic guard */

/** Search intents. A new post may not share an intent and the same place with an existing post. */
const INTENTS = [
  { kind: "top-places", re: /\b(top \d+ places|places to visit|top \d+ (sights|attractions))\b/i },
  { kind: "things-to-do", re: /\bthings to do\b/i },
  { kind: "best-time", re: /\bbest time to (visit|go)\b|\bwhen to (visit|go)\b|\bmonth[- ]by[- ]month\b/i },
  { kind: "itinerary", re: /\bitinerary\b|\b\d+[- ]days? (route|plan)\b|\b\d+ (days?|weeks?) in\b|\bin \d+ (days?|weeks?)\b/i },
  { kind: "day-trips", re: /\bday trips from\b/i },
  { kind: "costs", re: /\b(costs?|budget|prices?)\b/i },
  { kind: "travel-guide", re: /\btravel guide\b/i },
];

/** Words that describe the post type, not the place, so they are ignored when comparing places. */
const NON_PLACE = new Set(
  "time trips trip around near city cities region tour tours private costs cost budget prices price weather events month seasonal complete ultimate first timer timers sights attractions highlights tips practical".split(" "),
);

/** Headline before any ":" or "(", e.g. "Top 4 Places to Visit in Uzbekistan (2026 Guide)" -> "Top 4 Places to Visit in Uzbekistan". */
function headline(text) {
  return String(text || "").split(/[:(]/)[0].replace(/[–—]/g, " ").trim();
}

/** { kind, places } for a slug + title, e.g. top-places / {uzbekistan}. */
export function topicIntent(slug, title) {
  const head = headline(title) || String(slug || "").replace(/-/g, " ");
  const text = `${head} ${String(slug || "").replace(/-/g, " ")}`;
  const kind = INTENTS.find((i) => i.re.test(head))?.kind ?? INTENTS.find((i) => i.re.test(text))?.kind ?? "other";
  const places = new Set([...topicTokens(head)].filter((w) => !NON_PLACE.has(w) && !DURATION_WORDS.has(w)));
  // Itineraries: the trip length is part of the search ("Uzbekistan itinerary 5 days" and
  // "... 10 days" are different trips), bucketed so 5 vs 6 days still counts as the same search.
  if (kind === "itinerary") {
    const b = durationBucket(itineraryDays(`${head} ${text}`));
    if (b) places.add(b);
  }
  return { kind, places };
}

const DURATION_WORDS = new Set("week weeks night nights one two three four five six seven eight nine ten".split(" "));
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Trip length in days named in a keyword or title ("5 days", "2 weeks", "4 nights 5 days", "one week"), or 0. */
export function itineraryDays(text) {
  const t = String(text || "").toLowerCase().replace(/-/g, " ");
  const n = (x) => Number(x) || NUM_WORDS[x] || 0;
  const d = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten) days?\b/.exec(t);
  if (d) return n(d[1]);
  const w = /\b(\d|one|two|three|a) weeks?\b/.exec(t);
  if (w) return (w[1] === "a" ? 1 : n(w[1])) * 7;
  const nt = /\b(\d{1,2}) nights?\b/.exec(t);
  if (nt) return n(nt[1]) + 1;
  return 0;
}

/** Trip-length bucket used for duplicate checks: 1-2, 3-4, 5-6, 7-8, 9-11, 12-16, 17+ days. */
export function durationBucket(days) {
  if (!days) return "";
  if (days <= 2) return "len:1-2d";
  if (days <= 4) return "len:3-4d";
  if (days <= 6) return "len:5-6d";
  if (days <= 8) return "len:7-8d";
  if (days <= 11) return "len:9-11d";
  if (days <= 16) return "len:12-16d";
  return "len:17d+";
}

function samePlaces(a, b) {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Existing post that a new topic duplicates, or undefined. Checks, in order:
 *   1. same slug (published, unpublished or merged posts all count, so a merged slug is never reused);
 *   2. title/slug token overlap >= threshold (the original rule);
 *   3. same search intent (top places, best time, itinerary, ...) for the same place,
 *      e.g. "Top 4 places to visit in Uzbekistan" vs "Top 10 places to visit in Uzbekistan".
 *      Places must match exactly, so "Uzbekistan in winter" is not a repeat of "Uzbekistan travel guide".
 * `destination` (optional) limits rule 3 to posts about that destination.
 */
export function findDuplicateTopic({ slug, title, destination = "" }, existing, threshold = 0.6) {
  const tokens = topicTokens(`${slug} ${title}`);
  const intent = topicIntent(slug, title);
  for (const e of existing) {
    const p = e.post ?? e;
    if (!p?.slug) continue;
    if (p.slug === slug) return { post: p, reason: `same slug as ${p.slug}` };
    const otherTokens = topicTokens(`${p.slug} ${p.title?.en ?? ""}`);
    const sim = jaccard(tokens, otherTokens);
    // A one-word topic ("uzbekistan" from "Uzbekistan itinerary 10 days") cannot be judged by word
    // overlap; the same-intent rule below decides it.
    if (sim >= threshold && Math.min(tokens.size, otherTokens.size) >= 2) return { post: p, reason: `title too similar to ${p.slug} (${sim.toFixed(2)})` };
    if (intent.kind === "other") continue;
    if (destination && p.destination && p.destination !== destination) continue;
    const other = topicIntent(p.slug, p.title?.en ?? "");
    if (other.kind === intent.kind && samePlaces(intent.places, other.places)) {
      return { post: p, reason: `same topic (${intent.kind}: ${[...intent.places].join(" ")}) as ${p.slug}` };
    }
  }
  return undefined;
}

/* ------------------------------------------------------------ first-hand facts rule (AI search plan item 12) */

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
/** Concrete, checkable specifics a reader (or an AI answer) can quote. Prices come from catalog facts, not prose. */
const SPECIFIC_RES = [
  ["duration", /\b(?:\d+(?:[.,]\d+)?(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?|one|two|three|four|five|six|seven|eight|nine|ten|half an?|a half)[\s-]*(?:hours?|hrs?|minutes?|mins?|days?|nights?)(?:['’]s?)?\b/gi],
  ["distance", /\b\d[\d,.]*(?:\s*(?:-|–|to)\s*\d[\d,.]*)?\s*(?:km|kilometres?|kilometers?|miles?)\b/gi],
  ["altitude", /\b\d[\d,.]*\s*(?:m|metres?|meters?|ft|feet)\b(?=[^a-z]|$)/gi],
  ["season", new RegExp(`\\b${MONTH}\\s*(?:-|–|to|and|through)\\s*(?:(?:early|mid|late)[\\s-])?${MONTH}\\b`, "gi")],
  ["year", /\b(?:built|founded|dates? (?:from|back to)|since|in) (?:the )?(?:\d{1,2}(?:st|nd|rd|th) century|1\d{3}|20[0-2]\d)\b/gi],
];

/** Distinct specifics in a block of English text, as "kind:normalised text". */
export function concreteSpecifics(text) {
  const found = new Set();
  for (const [kind, re] of SPECIFIC_RES) {
    re.lastIndex = 0;
    for (const m of String(text ?? "").matchAll(re)) found.add(`${kind}:${m[0].toLowerCase().replace(/\s+/g, " ").trim()}`);
  }
  return [...found];
}

function englishBody(post) {
  return [
    post.intro?.en ?? "",
    ...(post.sections ?? []).flatMap((s) => [
      ...(s.paragraphs?.en ?? []),
      ...(s.keyFacts ?? []).map((f) => `${f.label?.en ?? ""} ${f.value?.en ?? ""}`),
    ]),
    ...(post.faqs ?? []).map((f) => f.a?.en ?? ""),
  ].join("\n");
}

const FILLER_OPENING_RE =
  /^(?:imagine|picture|welcome|nestled|are you|have you ever|if you(?:'|’)re|when it comes to|in today|there(?:'|’)s no|few places|looking for|dreaming of|whether you)/i;
const INVENTED_EXPERIENCE_RE =
  /\bI(?:['’]m|['’]ve|['’]d| (?:was|visited|went|saw|loved|stayed|have|had|remember|think|recommend|spent|found))\b|\b[Mm]y (?:trip|visit|first|last|favou?rite|time|experience|guide)\b|\b(?:guests?|clients?|customers?|travell?ers? on our tours?)\s+(?:often\s+|always\s+)?(?:told|tell us|said|say|wrote|raved|rave|loved|love)\b|\btestimonials?\b|\b\d(?:\.\d)?\s*out of 5\b|\b\d+\s+(?:reviews|ratings)\b|\brated\s+\d/;
const SEASON_WORD_RE = /\b(?:spring|summer|autumn|fall|winter|year-round)\b/i;

/**
 * Item 12 of the AI search plan. A post must:
 *   - open answer-first: the first ~200 characters of the English intro answer the title, with no
 *     scene-setting opener, and share words with the title or carry a specific;
 *   - carry at least `min` distinct concrete specifics (durations, drive times, distances, altitudes,
 *     month ranges, dates) in its English body; verified tour prices and lengths are added by code from
 *     the catalog (catalogFacts) and shown with a "Prices checked" month on the page;
 *   - not invent first-hand experiences, guest quotes, ratings or reviews.
 */
export function firstHandProblems(post, { min = 3 } = {}) {
  const problems = [];
  const intro = String(post.intro?.en ?? "").trim();
  const opening = intro.slice(0, 220);
  if (!opening) problems.push("no English intro");
  else {
    if (FILLER_OPENING_RE.test(opening)) problems.push(`intro does not open answer-first: "${opening.slice(0, 60)}…"`);
    const titleWords = new Set(topicTokens(post.title?.en ?? ""));
    const shared = [...topicTokens(opening)].filter((t) => titleWords.has(t));
    const concrete = concreteSpecifics(opening).length > 0 || SEASON_WORD_RE.test(opening);
    if (shared.length === 0 || (shared.length < 2 && !concrete))
      problems.push("first 200 characters of the intro neither answer the title nor give a specific");
  }
  const specifics = concreteSpecifics(englishBody(post));
  // Generated sections carry catalogFacts; saved posts have them merged into keyFacts.
  const catalogFacts = (post.sections ?? []).some(
    (s) =>
      (s.catalogFacts ?? []).length > 0 ||
      // A catalog price, or the code-written "Price on request" fact of a price-on-request tour.
      (s.keyFacts ?? []).some((f) => /\$\s?\d|^Price on request$/.test(typeof f.value === "string" ? f.value : (f.value?.en ?? ""))),
  );
  if (specifics.length < min)
    problems.push(`only ${specifics.length} concrete specific(s) (durations, distances, drive times, seasons; min ${min})`);
  if (!catalogFacts) problems.push("no verified tour facts (catalog price/length) in any section");
  walkStrings({ intro: post.intro?.en, sections: (post.sections ?? []).map((s) => s.paragraphs?.en), faqs: (post.faqs ?? []).map((f) => f.a?.en) }, (text, path) => {
    const m = INVENTED_EXPERIENCE_RE.exec(text);
    if (m) problems.push(`invented first-hand claim at ${path.join(".")}: "${m[0]}"`);
  });
  return problems;
}
