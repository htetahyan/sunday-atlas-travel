/**
 * Pure helpers for the machine-translation pipeline.
 * No network and no filesystem. Node 20 built-ins only.
 */
import { createHash } from "node:crypto";

export const LOCALES = ["en", "de", "fr", "ja", "es"];
export const TARGET_LOCALES = ["de", "fr", "ja", "es"];
export const TRANSLATE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const FALLBACK_TRANSLATE_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

// zh is a partial locale translated by scripts/zh-translate-next.mjs, not by this pipeline, but a
// field that already has zh must still count as a localized field here.
const LOCALE_SET = new Set([...LOCALES, "zh"]);

/** Workers AI neuron prices per 1,000,000 tokens. */
export const NEURON_RATES = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
    inputPerMillion: 26668,
    outputPerMillion: 204805,
  },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": {
    inputPerMillion: 31876,
    outputPerMillion: 50488,
  },
  "@cf/meta/llama-3.1-8b-instruct-fast": {
    inputPerMillion: 4119,
    outputPerMillion: 34868,
  },
  "@cf/meta/m2m100-1.2b": {
    combinedPerMillion: 31050,
  },
};

const LANGUAGE_NAME = {
  de: "German",
  fr: "French",
  ja: "Japanese",
  es: "Spanish",
};

/**
 * Reject reseller / intermediary wording. Same pattern as the Pages Function brand rule.
 * If the English source matches too, the translation is still rejected.
 */
export const BRAND_RE =
  /(?<![\p{L}])partners?(?![\p{L}])|partnerunternehmen|partenaires?|socios? locales?|local\s+(?:tour\s+)?operators?|lokale[nrm]?\s+(?:veranstalter|anbieter)|veranstalter vor ort|op[ée]rateurs? locaux?|op[ée]rateur local|operadore?s? locales?|third[\s-]*part|drittanbieter|(?<![\p{L}])tiers(?![\p{L}])|terceros|middle\s*m[ae]n|mittelsm|vermittler|(?<!(?:saisons?|couches?|niveaux?|p[ée]riodes?|[ée]tapes?|escales?|tailles?|zones?|altitudes?|stations?|gammes?|cat[ée]gories?|options?|mois|temp[ée]ratures?)\s)interm[ée]diaire|intermediari[oa]s?|resellers?|wiederverk[äa]uf|revendeur|revendedor|suppliers?|lieferant|zulieferer|fournisseurs?|proveedor|代理店|仲介|提携|現地パートナー|現地の(?:旅行)?会社/iu;

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const NUMBER_RE = /\d{1,3}(?:[ \u00A0\u202F\u2009]\d{3})+|\d{1,3}(?:[.,\u00A0\u202F\u2009']\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

const URL_RE = /https?:\/\/[^\s<>()"'[\]]+/gi;

const SITE_PATH_RE = /(?:^|[^A-Za-z0-9_~%])(\/(?:en|de|fr|ja|es)\/[A-Za-z0-9._~%+/-]*)/g;

const CURRENCY_CODES = ["USD", "EUR", "GBP", "JPY"];
const CURRENCY_SYMBOLS = ["$", "€", "£", "¥"];

export function languageName(locale) {
  return LANGUAGE_NAME[locale] || locale;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 of the canonical JSON of a value. */
export function hashCanonical(value) {
  return sha256Hex(canonicalJson(value));
}

export function neuronRateFor(model) {
  if (model && NEURON_RATES[model]) return NEURON_RATES[model];
  const name = typeof model === "string" ? model : "";
  if (name.includes("llama-3.3-70b")) {
    return NEURON_RATES["@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
  }
  if (name.includes("mistral-small-3.1")) {
    return NEURON_RATES["@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
  }
  if (name.includes("llama-3.1-8b-instruct-fast")) {
    return NEURON_RATES["@cf/meta/llama-3.1-8b-instruct-fast"];
  }
  if (name.includes("m2m100")) return NEURON_RATES["@cf/meta/m2m100-1.2b"];
  return NEURON_RATES["@cf/mistralai/mistral-small-3.1-24b-instruct"];
}

/** Estimated neurons for a model call. Combined rates apply to input + output. */
export function estimateNeurons(model, promptTokens, completionTokens) {
  const rate = neuronRateFor(model);
  const prompt = Number(promptTokens) || 0;
  const completion = Number(completionTokens) || 0;
  if (rate.combinedPerMillion != null) {
    return ((prompt + completion) / 1_000_000) * rate.combinedPerMillion;
  }
  return (prompt / 1_000_000) * rate.inputPerMillion + (completion / 1_000_000) * rate.outputPerMillion;
}

export function estimateTokensFromChars(chars) {
  const n = Number(chars) || 0;
  return Math.ceil(n / 4);
}

export function isLocalizedField(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  if (keys.length === 0 || !keys.every((key) => LOCALE_SET.has(key))) return false;
  if (!Object.prototype.hasOwnProperty.call(node, "en")) return false;
  const en = node.en;
  if (typeof en === "string") return true;
  return Array.isArray(en) && en.every((item) => typeof item === "string");
}

export function isSeoBlock(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  if (keys.length === 0 || !keys.every((key) => LOCALE_SET.has(key))) return false;
  const en = node.en;
  if (!en || typeof en !== "object" || Array.isArray(en)) return false;
  return (
    Object.prototype.hasOwnProperty.call(en, "seo_title") ||
    Object.prototype.hasOwnProperty.call(en, "meta_description") ||
    Object.prototype.hasOwnProperty.call(en, "focus_keyword") ||
    Object.prototype.hasOwnProperty.call(en, "keywords")
  );
}

export function isEmptyTranslationValue(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    return value.every((item) => typeof item !== "string" || item.trim() === "");
  }
  if (typeof value === "object") {
    const focus = typeof value.focus_keyword === "string" ? value.focus_keyword : "";
    const title = typeof value.seo_title === "string" ? value.seo_title : "";
    const keywords = Array.isArray(value.keywords) ? value.keywords : [];
    const keywordsEmpty =
      keywords.length === 0 || keywords.every((item) => typeof item !== "string" || item.trim() === "");
    return focus.trim() === "" && title.trim() === "" && keywordsEmpty;
  }
  return true;
}

/**
 * missing | stale | human | current | skip
 * `record` is the sidecar field object, or null.
 */
export function decideStatus(english, target, record, locale) {
  if (isEmptyTranslationValue(english)) return "skip";
  if (isEmptyTranslationValue(target)) return "missing";
  const recorded = record && typeof record[locale] === "string" ? record[locale] : "";
  if (!recorded) return "human";
  if (hashCanonical(target) !== recorded) return "human";
  const src = typeof record.src === "string" ? record.src : "";
  if (src !== hashCanonical(english)) return "stale";
  return "current";
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function keywordEnglish(block) {
  const en = block && block.en && typeof block.en === "object" ? block.en : {};
  return {
    focus_keyword: typeof en.focus_keyword === "string" ? en.focus_keyword : "",
    keywords: Array.isArray(en.keywords) ? en.keywords.filter((item) => typeof item === "string") : [],
    seo_title: typeof en.seo_title === "string" ? en.seo_title : "",
  };
}

function keywordTarget(block, locale) {
  const node = block && block[locale] && typeof block[locale] === "object" ? block[locale] : {};
  return {
    focus_keyword: typeof node.focus_keyword === "string" ? node.focus_keyword : "",
    keywords: Array.isArray(node.keywords) ? node.keywords.filter((item) => typeof item === "string") : [],
  };
}

function stringTarget(node, locale) {
  if (!node || typeof node !== "object") return "";
  const value = node[locale];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : ""));
  return "";
}

function ensureSeoLocale(seo, locale) {
  const current = seo[locale];
  if (current && typeof current === "object" && !Array.isArray(current)) return current;
  const en = seo.en && typeof seo.en === "object" ? seo.en : {};
  const created = {
    seo_title: "",
    meta_description: "",
    focus_keyword: "",
    keywords: [],
    og_image: typeof en.og_image === "string" ? en.og_image : "",
    canonical: typeof en.canonical === "string" ? en.canonical : "",
    noindex: true, // a new locale block stays out of the index until the pipeline publishes it
  };
  seo[locale] = created;
  return created;
}

/**
 * Localized fields and SEO strings/keywords in document order.
 * Each field carries setters that mutate `doc`.
 */
export function collectFields(doc, sidecar) {
  const records =
    sidecar && sidecar.fields && typeof sidecar.fields === "object" && !Array.isArray(sidecar.fields)
      ? sidecar.fields
      : {};
  const fields = [];
  walk(doc, "", fields, records);
  return fields;
}

/** Package section headings come from the dictionaries, not the entry. */
const SKIP_TOP_LEVEL = new Set(["headings"]);

function walk(node, path, fields, records) {
  if (path === "" && node && typeof node === "object" && !Array.isArray(node)) {
    for (const key of Object.keys(node)) {
      if (SKIP_TOP_LEVEL.has(key) && Array.isArray(node.itinerary)) continue;
      walk(node[key], key, fields, records);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, fields, records));
    return;
  }
  if (!node || typeof node !== "object") return;
  if (isSeoBlock(node)) {
    addSeo(node, path || "seo", fields, records);
    return;
  }
  if (isLocalizedField(node)) {
    addLocalized(node, path, fields, records);
    return;
  }
  for (const key of Object.keys(node)) {
    const child = path ? `${path}.${key}` : key;
    walk(node[key], child, fields, records);
  }
}

function addLocalized(node, path, fields, records) {
  const english = snapshot(node.en);
  const kind = Array.isArray(english) ? "list" : "string";
  const record = records[path] && typeof records[path] === "object" ? records[path] : null;
  const statuses = {};
  const targets = {};
  for (const locale of TARGET_LOCALES) {
    const target = snapshot(stringTarget(node, locale));
    targets[locale] = target;
    statuses[locale] = decideStatus(english, target, record, locale);
  }
  fields.push({
    path,
    kind,
    english,
    record,
    statuses,
    targets,
    set(locale, value) {
      node[locale] = value;
    },
  });
}

function addSeo(seo, path, fields, records) {
  const en = seo.en && typeof seo.en === "object" ? seo.en : {};
  for (const key of ["seo_title", "meta_description"]) {
    const fieldPath = `${path}.${key}`;
    const english = typeof en[key] === "string" ? en[key] : "";
    const record = records[fieldPath] && typeof records[fieldPath] === "object" ? records[fieldPath] : null;
    const statuses = {};
    const targets = {};
    for (const locale of TARGET_LOCALES) {
      const block = seo[locale];
      const target = block && typeof block === "object" && typeof block[key] === "string" ? block[key] : "";
      targets[locale] = target;
      statuses[locale] = decideStatus(english, target, record, locale);
    }
    fields.push({
      path: fieldPath,
      kind: "string",
      english,
      record,
      statuses,
      targets,
      set(locale, value) {
        ensureSeoLocale(seo, locale)[key] = value;
      },
    });
  }

  const fieldPath = `${path}.keywords`;
  const english = keywordEnglish(seo);
  const record = records[fieldPath] && typeof records[fieldPath] === "object" ? records[fieldPath] : null;
  const statuses = {};
  const targets = {};
  for (const locale of TARGET_LOCALES) {
    const target = keywordTarget(seo, locale);
    targets[locale] = target;
    statuses[locale] = decideStatus(english, target, record, locale);
  }
  fields.push({
    path: fieldPath,
    kind: "keywords",
    english,
    record,
    statuses,
    targets,
    set(locale, value) {
      const block = ensureSeoLocale(seo, locale);
      block.focus_keyword = value.focus_keyword;
      block.keywords = value.keywords;
    },
  });
}

export function numberMultiset(text) {
  const source = String(text ?? "").normalize("NFKC");
  const found = [];
  for (const match of source.matchAll(NUMBER_RE)) {
    found.push(match[0].replace(/\D/g, ""));
  }
  found.sort();
  return found;
}

function trimTrail(value) {
  return value.replace(/[.,);:!?]+$/g, "");
}

export function extractUrls(text) {
  const found = [];
  for (const match of String(text ?? "").matchAll(URL_RE)) found.push(trimTrail(match[0]));
  return found;
}

export function extractSitePaths(text) {
  const stripped = String(text ?? "").replace(URL_RE, " ");
  const found = [];
  for (const match of stripped.matchAll(SITE_PATH_RE)) found.push(trimTrail(match[1]));
  return found;
}

function normalizeSitePath(path, targetLocale) {
  const match = path.match(/^\/(en|de|fr|ja|es)(\/.*)?$/);
  if (!match) return path;
  if (match[1] === "en" || match[1] === targetLocale) return `/{locale}${match[2] || ""}`;
  return path;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameList(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function currenciesIn(text) {
  const source = String(text ?? "").normalize("NFKC");
  const found = [];
  for (const symbol of CURRENCY_SYMBOLS) {
    if (source.includes(symbol)) found.push(symbol);
  }
  for (const code of CURRENCY_CODES) {
    const re = new RegExp(`(?<![A-Za-z])${code}(?![A-Za-z])`);
    if (re.test(source) || CURRENCY_NAMES[code].some((name) => source.includes(name))) found.push(code);
  }
  return found;
}

/** Native names that count as the currency code (ja writes USD as 米ドル). */
const CURRENCY_NAMES = {
  USD: ["米ドル", "USドル", "アメリカドル"],
  EUR: ["ユーロ"],
  GBP: ["英ポンド"],
  JPY: ["日本円"],
};

const NUMBER_WORD_RE =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|single|double|twin|both|once|twice|half|per|pp|each|a day|a night|a person|an hour|a week|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;

/** 4x4 / 4×4 / 4WD / 四駆 are the same vehicle; count none of their digits. */
const FOUR_BY_FOUR_RE = /4\s*[x×]\s*4|4\s*WD|四駆/gi;

/**
 * Every number in the English must survive unchanged. The translation may add a few
 * small counters (1–31) where English used words: "per person" → 1人あたり,
 * "day one" → 1日目, "one to six" → 1人から6人. Extras are capped by the number
 * of such words in the English.
 */
export function numbersPreserved(english, out) {
  const left = numberMultiset(String(english ?? "").normalize("NFKC").replace(FOUR_BY_FOUR_RE, " FOURBYFOUR "));
  const right = numberMultiset(String(out ?? "").normalize("NFKC").replace(FOUR_BY_FOUR_RE, " FOURBYFOUR "));
  const pool = new Map();
  for (const n of right) pool.set(n, (pool.get(n) || 0) + 1);
  for (const n of left) {
    const count = pool.get(n) || 0;
    if (count === 0) return false;
    pool.set(n, count - 1);
  }
  let extras = 0;
  for (const [n, count] of pool) {
    if (count === 0) continue;
    const value = Number(n);
    if (!Number.isInteger(value) || value < 1 || value > 31) return false;
    extras += count;
  }
  const allowance = (String(english ?? "").match(NUMBER_WORD_RE) || []).length;
  return extras <= allowance;
}

function placeholdersIn(text) {
  const source = String(text ?? "");
  const doubles = [...source.matchAll(/\{\{[^{}]+\}\}/g)].map((match) => match[0]);
  const withoutDoubles = source.replace(/\{\{[^{}]+\}\}/g, " ");
  const singles = [...withoutDoubles.matchAll(/\{[^{}]+\}/g)].map((match) => match[0]);
  const prints = [...source.matchAll(/%s/g)].map((match) => match[0]);
  const tags = [...source.matchAll(/<\/?[A-Za-z][^>\n]*>/g)].map((match) => match[0]);
  return [...doubles, ...singles, ...prints, ...tags].sort();
}

function countLines(text, re) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => re.test(line)).length;
}

function markdownCounts(text) {
  return {
    headings: countLines(text, /^\s*#{1,6}\s+\S/),
    lists: countLines(text, /^\s*(?:[-*]|\d+\.)\s+\S/),
    links: [...String(text ?? "").matchAll(/\[[^\]\n]+\]\([^)\n]+\)/g)].length,
    bolds: [...String(text ?? "").matchAll(/\*\*/g)].length,
  };
}

function brandReasons(outText, englishText) {
  const reasons = [];
  if (!BRAND_RE.test(outText)) return reasons;
  reasons.push("brand wording");
  BRAND_RE.lastIndex = 0;
  if (englishText && BRAND_RE.test(englishText)) {
    reasons.push("english also contains brand wording; fix the English source");
  }
  BRAND_RE.lastIndex = 0;
  return reasons;
}

function validateString(en, out, locale) {
  const reasons = [];
  if (typeof out !== "string") return { ok: false, reasons: ["not a string"] };
  if (out.trim() === "") return { ok: false, reasons: ["empty"] };
  const english = typeof en === "string" ? en : "";
  const left = english.normalize("NFKC");
  const right = out.normalize("NFKC");
  if (locale === "ja" && !CJK_RE.test(right)) reasons.push("missing CJK characters");
  if (hasGenderForm(right, locale)) reasons.push("gender-star form");
  if (!numbersPreserved(left, right)) reasons.push("numbers differ");
  if (!sameList(sortedUnique(extractUrls(left)), sortedUnique(extractUrls(right)))) reasons.push("urls differ");
  const enPaths = sortedUnique(extractSitePaths(left).map((path) => normalizeSitePath(path, locale)));
  const outPaths = sortedUnique(extractSitePaths(right).map((path) => normalizeSitePath(path, locale)));
  if (!sameList(enPaths, outPaths)) reasons.push("paths differ");
  for (const token of currenciesIn(left)) {
    if (!currenciesIn(right).includes(token)) reasons.push(`missing currency ${token}`);
  }
  if (!sameList(placeholdersIn(left), placeholdersIn(right))) reasons.push("placeholders differ");
  const enMd = markdownCounts(left);
  const outMd = markdownCounts(right);
  if (enMd.headings !== outMd.headings) reasons.push("heading lines differ");
  if (enMd.lists !== outMd.lists) reasons.push("list lines differ");
  if (enMd.links !== outMd.links) reasons.push("links differ");
  if (enMd.bolds !== outMd.bolds) reasons.push("bold markers differ");
  reasons.push(...brandReasons(right, left));
  return { ok: reasons.length === 0, reasons };
}

/**
 * String, string-array, or keyword-object check.
 * Keyword objects are `{ focus_keyword, keywords }` (the MT output).
 */
/** German gender-star, colon or underscore forms (Reisende*r, eine*n, Guide:innen, Gäste_innen) and French middle-dot forms. */
const GENDER_FORM_RE = {
  de: /\p{L}[*:_](?:innen|in|r|n|en|e|er|em|es)(?!\p{L})/u,
  fr: /\p{L}[·•](?:e|es|euse|euses|rice|rices|ne|nes)(?!\p{L})/u,
};

export function hasGenderForm(text, locale) {
  const re = GENDER_FORM_RE[locale];
  if (!re) return false;
  return re.test(String(text ?? "").replace(/https?:\/\/\S+/g, " "));
}

export function validateTranslation(en, out, locale) {
  if (out && typeof out === "object" && !Array.isArray(out) && Array.isArray(out.keywords)) {
    return validateKeywords(out, locale, en);
  }
  if (Array.isArray(en) || Array.isArray(out)) return validateList(en, out, locale);
  return validateString(en, out, locale);
}

function validateList(en, out, locale) {
  if (!Array.isArray(en) || !Array.isArray(out)) return { ok: false, reasons: ["not an array"] };
  if (en.length !== out.length) return { ok: false, reasons: ["length differs"] };
  const reasons = [];
  for (let i = 0; i < en.length; i += 1) {
    const english = en[i];
    const translated = out[i];
    if (typeof english !== "string" || english.trim() === "") {
      if (typeof translated !== "string" || translated.trim() !== "") {
        reasons.push(`[${i}] expected empty`);
      }
      continue;
    }
    const result = validateString(english, translated, locale);
    for (const reason of result.reasons) reasons.push(`[${i}] ${reason}`);
  }
  return { ok: reasons.length === 0, reasons };
}

function validateKeywords(out, locale, english) {
  const reasons = [];
  const focus = out && typeof out.focus_keyword === "string" ? out.focus_keyword.trim() : "";
  if (!focus) reasons.push("focus_keyword empty");
  const raw = out && Array.isArray(out.keywords) ? out.keywords : null;
  if (!raw) {
    reasons.push("keywords missing");
    return { ok: false, reasons };
  }
  const keywords = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.trim() === "") {
      reasons.push("empty keyword");
      continue;
    }
    keywords.push(item.trim());
  }
  if (keywords.length < 5 || keywords.length > 15) reasons.push(`keywords count ${keywords.length}`);
  const seen = new Set();
  let duplicate = false;
  for (const keyword of keywords) {
    const key = keyword.normalize("NFKC").toLowerCase();
    if (seen.has(key)) duplicate = true;
    seen.add(key);
  }
  if (duplicate) reasons.push("duplicate keywords");
  const blob = [focus, ...keywords].join("\n").normalize("NFKC");
  if (locale === "ja") {
    if (focus && !CJK_RE.test(focus.normalize("NFKC"))) reasons.push("focus_keyword missing CJK characters");
    if (keywords.some((keyword) => !CJK_RE.test(keyword.normalize("NFKC")))) {
      reasons.push("keyword missing CJK characters");
    }
  }
  const englishBlob =
    english && typeof english === "object"
      ? JSON.stringify(english)
      : typeof english === "string"
        ? english
        : "";
  reasons.push(...brandReasons(blob, englishBlob.normalize("NFKC")));
  return { ok: reasons.length === 0, reasons };
}

/**
 * Deterministic stand-in. Keep identical to functions/api/translate.ts.
 * Translate: `「${target}」 ` + text. Keywords: 8 queries (`日本 キーワード n` for ja).
 */
export function mockTranslate(target, mode, items) {
  const results = {};
  const list = Array.isArray(items) ? items : [];
  if (mode === "keywords") {
    for (const item of list) {
      const id = item && typeof item.id === "string" ? item.id : "";
      if (!id) continue;
      const keywords = [];
      for (let n = 1; n <= 8; n += 1) {
        keywords.push(target === "ja" ? `日本 キーワード ${n}` : `${target} kw ${n}`);
      }
      results[id] = {
        focus_keyword: target === "ja" ? "日本 フォーカス" : `${target} focus`,
        keywords,
      };
    }
    return results;
  }
  for (const item of list) {
    const id = item && typeof item.id === "string" ? item.id : "";
    if (!id) continue;
    const text = item && typeof item.text === "string" ? item.text : "";
    results[id] = `「${target}」 ${text}`;
  }
  return results;
}

export function packBatches(items, maxItems = 30, maxChars = 9000) {
  const batches = [];
  let batch = [];
  let chars = 0;
  const flush = () => {
    if (batch.length === 0) return;
    batches.push(batch);
    batch = [];
    chars = 0;
  };
  for (const item of items) {
    const size = Number(item.chars) || 0;
    if (size > maxChars) {
      flush();
      batches.push([item]);
      continue;
    }
    if (batch.length >= maxItems || (batch.length > 0 && chars + size > maxChars)) flush();
    batch.push(item);
    chars += size;
  }
  flush();
  return batches;
}

export function buildSystemPrompt(target, mode) {
  const language = languageName(target);
  const shared = [
    `You are a professional travel copywriter for Sunday Atlas Travel.`,
    `Write in ${language}. Natural and idiomatic, not a literal translation.`,
    `Never describe the company as a reseller or intermediary and never mention or name other companies: no partners, local operators, third parties, middlemen or suppliers.`,
    `Sunday Atlas Travel plans the trips itself and arranges hotels, transport and guides. Keep first-person ownership natural: "our guide" and "our glamping camp" become e.g. German "unser Guide" / "unser Glamping-Camp", Japanese "当社のガイド" / "当社のグランピングキャンプ", French "notre guide" / "notre camp de glamping", Spanish "nuestro guía" / "nuestro campamento de glamping".`,
  ];
  if (mode === "keywords") {
    return [
      ...shared,
      `Produce 8–12 natural search queries people in ${language} would type for this page, in that language and script, lowercase where that is natural, plus one focus keyword.`,
      `Do not translate the English keywords literally. Write native search terms.`,
      `Return ONLY a JSON object mapping each id to {"focus_keyword":"...","keywords":["..."]}.`,
    ].join(" ");
  }
  return [
    ...shared,
    `Translate the English website copy into ${language}.`,
    `Keep every number, price, currency symbol, unit, date, URL, slug, placeholder, markdown and line breaks exactly.`,
    `Keep proper names of places and hotels recognizable. Use the standard exonym in the target language, for example Japanese katakana アルマトイ or German "Almaty".`,
    `Use neutral plural nouns for people (German "Reisende", "Gäste", "Alleinreisende"; French "les voyageurs"; Spanish "los viajeros"). Never use gender-star, colon, underscore or middle-dot forms such as "Reisende*r", "eine*n", "Guide:innen", "Gäste_innen" or "voyageur·euse".`,
    `Use exactly one form for each place name within an entry and keep it in every field, for example German "Charyn-Canyon" (never also "Charyn-Schlucht"), Japanese "トゥルゲン" and "アッシ高原" (never mixed variants).`,
    `Translate tree and plant species precisely: spruce is German "Fichte" and Japanese "トウヒ" (not pine/マツ or fir/Tanne/モミ), fir is "Tanne"/"モミ", pine is "Kiefer"/"マツ", ash is "Esche"/"トネリコ", willow is "Weide"/"ヤナギ". Keep named species with their name ("Schrenk spruce" → "Schrenk-Fichte" / "シュレンクトウヒ").`,
    `Keep star ratings like 3* and 4*.`,
    `Return ONLY a JSON object mapping each id to its translation string.`,
  ].join(" ");
}

export function contextForFolder(folder) {
  if (folder === "packages") return "tour package page";
  if (folder === "destinations") return "destination page";
  if (folder === "blog") return "travel guide & blog article";
  return "website page";
}

/** English characters counted toward the batch and API limits. */
export function englishChars(item) {
  if (!item || typeof item !== "object") return 0;
  if (typeof item.text === "string") return item.text.length;
  let n = 0;
  if (typeof item.title === "string") n += item.title.length;
  if (typeof item.focus_keyword === "string") n += item.focus_keyword.length;
  if (Array.isArray(item.keywords)) {
    for (const keyword of item.keywords) {
      if (typeof keyword === "string") n += keyword.length;
    }
  }
  return n;
}
