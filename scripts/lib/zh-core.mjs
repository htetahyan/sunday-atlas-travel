/**
 * Simplified Chinese (zh) machine translation for site copy: dictionary strings, tours,
 * destinations and static pages. Uses the blog AI client (NVIDIA free API first, Workers AI
 * as last resort). Every string is validated before it is kept; a failing string is retried
 * once on its own and otherwise left empty, so nothing half-translated reaches a /zh/ page.
 */
import { chat, TRANSLATE_MODEL, parseJsonObject } from "./blog-ai-client.mjs";
import { numbersPreserved } from "./auto-translate-core.mjs";
import { supplierNameRegex } from "./suppliers.mjs";
import { targetYear } from "./target-year.mjs";

export const ZH = "zh";
const HAN_RE = /\p{Script=Han}/u;
const LATIN_WORD_RE = /[A-Za-z]{3,}/;
/** Model slips seen in practice: Hangul or kana inside a Chinese place name. */
const FOREIGN_SCRIPT_RE = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}]/u;

/**
 * Words we never use about ourselves or the trips: "tailor-made / bespoke / curated" SEO words,
 * intermediary / supplier wording, and reply-time promises.
 */
export const ZH_BANNED_RE =
  /定制|订制|量身|私人订|精心策划|精心挑选|精选|供应商|供货商|合作伙伴|合作方|地接|第三方|中间商|代理商|分销|批发商|\d+\s*小时内(?:回复|答复|回覆)|(?:当天|即时|立即)(?:回复|答复)/;

const SYSTEM = (year) => `You translate website copy for Sunday Atlas Travel, a small travel company that runs private tours, from English into Simplified Chinese (zh-Hans, mainland China usage).
Rules:
- Natural, clear Simplified Chinese travel copy. No Traditional characters. Use full-width Chinese punctuation in Chinese sentences.
- Keep every number as Arabic digits exactly as in the English (7 days -> 7天, 2 nights -> 2晚). Keep prices, currency codes and symbols (USD, $, €) unchanged.
- Keep placeholders such as {count} or {title}, HTML tags, Markdown (#, -, **, links) and URLs exactly as they are.
- Place names: use the standard Chinese name when one is common (Kraków 克拉科夫, Tashkent 塔什干, Samarkand 撒马尔罕, Yerevan 埃里温, Baku 巴库, Almaty 阿拉木图, Bishkek 比什凯克, Harbin 哈尔滨, Thimphu 廷布). For small places without a common Chinese name, keep the original Latin spelling.
- Brand names stay in English: "Sunday Atlas Travel", "Sunday Atlas".
- Our tour names (for example "3 Stans Discovery", "Four Stans Odyssey", "The Long Road Through the 5 Stans") stay in English, exactly as written, when a sentence mentions them. When the text itself is a tour's title, translate it but keep every digit (3 Stans Discovery -> 中亚3国探索之旅).
- Never write a number as a Chinese numeral when the English uses digits, and never turn an English number word into a digit unless it is part of a duration (two days -> 2天 is fine).
- Write only Simplified Chinese plus the Latin names above: no Korean, Japanese kana or Cyrillic letters.
- Never use the words 定制, 量身定制, 私人订制, 精心策划, 精选 (we do not market trips as tailor-made, bespoke or curated). Say 按您的需求安排 or 为您安排 instead when needed.
- Never mention partners, suppliers, agencies, operators, middlemen or third parties (no 供应商, 合作伙伴, 地接, 第三方, 代理商). We describe the trip as ours.
- Never promise a reply time (no "24小时内回复").
- When the English uses a year as a freshness label, use ${year}; keep real dates and season ranges unchanged.
- Translate meaning, not word by word. Do not add facts, prices, or promises that are not in the English.
Answer with JSON only.`;

/**
 * Legal and practical copy sometimes really says "third party" or "payment partner"; a faithful
 * translation may then use 第三方 / 合作方. Everything else in ZH_BANNED_RE is never allowed.
 */
function allowedByEnglish(word, english) {
  if (word === "第三方") return /third[\s-]*part/i.test(english);
  if (word === "合作方" || word === "合作伙伴") return /partner/i.test(english);
  return false;
}

export function zhProblems(en, zh, { requireHan = true } = {}) {
  const reasons = [];
  if (typeof zh !== "string" || !zh.trim()) return ["empty"];
  const left = String(en ?? "").normalize("NFKC");
  const right = zh.normalize("NFKC");
  if (requireHan && LATIN_WORD_RE.test(left) && !HAN_RE.test(right)) reasons.push("no Chinese characters");
  if (!numbersPreserved(left, right)) reasons.push("numbers differ");
  const foreign = right.match(FOREIGN_SCRIPT_RE);
  if (foreign && !FOREIGN_SCRIPT_RE.test(left)) reasons.push(`foreign script "${foreign[0]}"`);
  const ph = (t) => [...t.matchAll(/\{\{?[^{}]+\}?\}|%s|<\/?[A-Za-z][^>\n]*>/g)].map((m) => m[0]).sort().join("|");
  if (ph(left) !== ph(right)) reasons.push("placeholders differ");
  const urls = (t) => [...t.matchAll(/https?:\/\/[^\s<>()"'[\]，。）]+/g)].map((m) => m[0].replace(/[.,;:]+$/, "")).sort().join("|");
  if (urls(left) !== urls(right)) reasons.push("urls differ");
  const banned = right.match(ZH_BANNED_RE);
  if (banned && !allowedByEnglish(banned[0], left)) reasons.push(`banned wording "${banned[0]}"`);
  const sup = supplierNameRegex();
  sup.lastIndex = 0;
  if (sup.test(right)) reasons.push("supplier name");
  const stale = String(targetYear() - 1);
  if (right.includes(stale) && !left.includes(stale)) reasons.push(`year ${stale}`);
  return reasons;
}

/** Leading/trailing markdown structure must survive for long fields. */
function lines(t, re) {
  return String(t).split(/\r?\n/).filter((l) => re.test(l)).length;
}
function structureProblems(en, zh) {
  const r = [];
  if (lines(en, /^\s*#{1,6}\s/) !== lines(zh, /^\s*#{1,6}\s/)) r.push("heading lines differ");
  if (lines(en, /^\s*(?:[-*]|\d+\.)\s/) !== lines(zh, /^\s*(?:[-*]|\d+\.)\s/)) r.push("list lines differ");
  return r;
}

async function callModel(items, { context = "", keywords = false } = {}) {
  const year = targetYear();
  const payload = Object.fromEntries(items.map((it) => [it.id, it.text]));
  const user = keywords
    ? `Context: ${context}\nFor each id, write 6 to 10 short search phrases that Chinese travellers would type into Baidu or Google for this page (Simplified Chinese, no duplicates, no brand names, none of the banned words). Return JSON {"id": ["phrase", ...]}.\n${JSON.stringify(payload)}`
    : `${context ? `Context: ${context}\n` : ""}Translate every value into Simplified Chinese. Return JSON with exactly the same ids as keys and the translation as each value.\n${JSON.stringify(payload)}`;
  const { text, model } = await chat({
    model: TRANSLATE_MODEL,
    locale: ZH,
    temperature: 0.2,
    max_tokens: Math.min(16000, 800 + Math.ceil(JSON.stringify(payload).length * 1.6)),
    messages: [
      { role: "system", content: SYSTEM(year) },
      { role: "user", content: user },
    ],
  });
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") throw new Error(`model ${model} returned no JSON`);
  return { parsed, model };
}

function batches(items, maxChars = 3500, maxItems = 25) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const it of items) {
    const n = it.text.length;
    if (cur.length && (size + n > maxChars || cur.length >= maxItems)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Translate [{ id, text }] into zh. Returns { done: Map<id, zh>, failed: [{ id, reasons }] , models }.
 * Strings that fail validation twice are reported in `failed` and left out of `done`.
 */
export async function translateStrings(items, { context = "", log = console.log } = {}) {
  const done = new Map();
  const failed = [];
  const models = new Set();
  const check = (it, value) => {
    const r = zhProblems(it.text, value);
    if (typeof value === "string") r.push(...structureProblems(it.text, value));
    return r;
  };
  const todo = items.filter((it) => typeof it.text === "string" && it.text.trim());
  const retry = [];
  for (const batch of batches(todo)) {
    let parsed = {};
    try {
      const res = await callModel(batch, { context });
      parsed = res.parsed;
      models.add(res.model);
    } catch (err) {
      log(`  ⚠ batch of ${batch.length} failed: ${err.message}`);
    }
    for (const it of batch) {
      const value = typeof parsed[it.id] === "string" ? parsed[it.id].trim() : undefined;
      const reasons = check(it, value);
      if (reasons.length === 0) done.set(it.id, value);
      else retry.push({ it, reasons });
    }
  }
  for (const { it, reasons: first } of retry) {
    let reasons = first;
    let value;
    for (let attempt = 0; attempt < 2 && reasons.length > 0; attempt++) {
      try {
        const hint = `The previous translation was rejected (${reasons.join(", ")}). Fix that.`;
        const res = await callModel([it], { context: context ? `${context}\n${hint}` : hint });
        models.add(res.model);
        value = typeof res.parsed[it.id] === "string" ? res.parsed[it.id].trim() : undefined;
      } catch (err) {
        log(`  ⚠ retry ${it.id} failed: ${err.message}`);
        value = undefined;
      }
      reasons = check(it, value);
    }
    if (reasons.length === 0) done.set(it.id, value);
    else {
      failed.push({ id: it.id, reasons });
      log(`  ✗ ${it.id}: ${reasons.join(", ")}`);
    }
  }
  return { done, failed, models: [...models] };
}

/** Native zh search phrases for one page. Returns string[] (may be empty). */
export async function zhKeywords(id, englishSummary, context = "") {
  try {
    const { parsed } = await callModel([{ id, text: englishSummary }], { context, keywords: true });
    const list = Array.isArray(parsed[id]) ? parsed[id] : [];
    const seen = new Set();
    return list
      .map((s) => String(s).trim())
      .filter((s) => s && HAN_RE.test(s) && !ZH_BANNED_RE.test(s) && !seen.has(s) && seen.add(s))
      .slice(0, 12);
  } catch {
    return [];
  }
}
