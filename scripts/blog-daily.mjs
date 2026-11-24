#!/usr/bin/env node
import { dailyBudget, DAILY_GENERATION_LIMIT } from "./lib/blog-daily-budget.mjs";
/**
 * Daily blog job.
 *   1. New posts: exactly 1 TOTAL per Asia/Dubai day, ONE destination per run
 *      (scripts/lib/blog-rotation.mjs, state in content/blog-rotation.json). Picks the next
 *      destination with linkable packages and the fewest posts that has not had a run in the
 *      current pass, takes its next unused, highest-priority keyword from the keyword bank
 *      (content/blog-keywords.json, researched once by scripts/build-keyword-bank.mjs; no live
 *      research per run), skipping any an existing post already covers, then writes one post in
 *      en/de/fr/ja/es. --count is capped at the daily limit. Queue/template topics are reserves
 *      and the fallback when the bank runs low. Each post must pass every quality gate or it is
 *      skipped and the next topic or destination is tried (up to --max-destinations, default 3).
 *      Idempotent: a day that already has its post writes nothing. A destination that yields
 *      0 posts is blocked for that UTC date and the same process immediately plans the next
 *      destination. --topic=<id> or --no-rotation uses plain queue order.
 *   2. Seasonal refresh: for up to --refresh posts (default 2), oldest `updatedAt` first, adds or
 *      rewrites a "this month" section when the post has none for the current month. That is a
 *      real content change, so the post's updatedAt moves (via finalizeDates).
 *
 * Usage:
 *   node scripts/blog-daily.mjs [--count=1] [--refresh=2] [--slot=auto|0] [--date=YYYY-MM-DD]
 *                               [--topic=<id>] [--no-rotation] [--no-bank] [--dry-run] [--preview]
 *   node scripts/blog-rotation-plan.mjs --days=7   (preview only: no AI, no writes)
 *                               [--min-age-days=7] [--max-minutes=0] [--report=<file>]
 * --dry-run uses a mock model (BLOG_AI_MOCK=1) and writes nothing.
 * --preview uses the real model but writes the posts to blog-preview/ only (no content/, state or uploads).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { targetYear, fixYearLabels, fixYearLabelsDeep } from "./lib/target-year.mjs";
import { clickableTitleProblems, itineraryPlan, normalizeTitles, repairTitles, SEO_TITLE_MAX, TITLE_RULES, DESCRIPTION_RULES } from "./lib/blog-titles.mjs";
const YEAR = targetYear();
import { pathToFileURL } from "node:url";
import {
  BRAND_RE,
  buildSystemPrompt,
  numberMultiset,
  packBatches,
  validateTranslation,
} from "./lib/auto-translate-core.mjs";
import {
  BANNED_RE,
  BLOG_DIR,
  LOCALES,
  QUEUE_FILE,
  SITE_ORIGIN,
  SUPPLIER_RE,
  contentHash,
  countWords,
  dateValue,
  englishWordCount,
  finalizeDates,
  brandNeutral,
  inventedPrices,
  isLivePackage,
  isLinkablePackage,
  findDuplicateTopic,
  loadCatalog,
  loadPosts,
  nowIso,
  readJson,
  readingMinutes,
  slugify,
  wordingProblems,
  writeJson,
  firstHandProblems,
} from "./lib/blog-core.mjs";
import {
  TEXT_MODEL,
  TRANSLATE_MODEL,
  backend,
  chat,
  describeModels,
  ledger,
  parseJsonObject,
  translateM2M,
  translateModelsFor,
} from "./lib/blog-ai-client.mjs";
import { recordChanged } from "./blog-refresh.mjs";
import { pickPostImages, imageFinderStatus } from "./lib/blog-images.mjs";
import {
  loadRegistry,
  saveRegistry,
  clearUses,
  findBySrc,
} from "./lib/image-registry.mjs";
import { currentSlot, destinationPackages, loadRotation, materializeTopic, pickSlot, planRun, recordBlocked, recordDay, saveRotation } from "./lib/blog-rotation.mjs";
import { bankRemaining, bankTopics, keywordProblems, loadKeywordStore, markBankUsed, saveKeywordStore } from "./lib/keyword-research.mjs";
import { seedRegistry } from "./image-registry.mjs";

/** Site-wide image registry (content/image-registry.json), loaded in main(). */
let REGISTRY = { version: 1, images: [] };
/** The current post's image search, so a failed post can wait for it before releasing its images. */
let PENDING_IMAGES = Promise.resolve(null);
const IMAGE_FINDER = !DRY_FLAG() && !process.argv.includes("--preview") && process.env.BLOG_IMAGE_FINDER !== "0";
function DRY_FLAG() {
  return process.argv.includes("--dry-run");
}

const TARGETS = LOCALES.filter((l) => l !== "en");
const MIN_WORDS = Number(process.env.BLOG_MIN_WORDS || 1200);
const SECTION_MIN_WORDS = Number(process.env.BLOG_SECTION_MIN_WORDS || 190);
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const DRY = Boolean(args["dry-run"]);
if (DRY) process.env.BLOG_AI_MOCK = "1";
// --preview: real model, nothing written to content/ (posts go to blog-preview/ for review), no image uploads.
const PREVIEW = Boolean(args.preview);
const WRITE = !DRY && !PREVIEW;
const COUNT = Math.min(DAILY_GENERATION_LIMIT, Math.max(1, Number(args.count ?? 1)));
const REFRESH = Number(args.refresh ?? 2);
const MIN_AGE_DAYS = Number(args["min-age-days"] ?? 7);
const MAX_ATTEMPTS = Number(args["max-attempts"] ?? COUNT + 3);
// Cap how many destinations one process will try after 0-post failures (Turkmenistan sticky loop).
const MAX_DEST_TRIES = Number(args["max-destinations"] ?? 3);
// Wall-clock budget: no new topic or refresh starts after this many minutes (0 = no limit),
// so a slow free-tier API cannot push the CI job past its timeout and lose finished posts.
const MAX_MINUTES = Number(args["max-minutes"] ?? 0);
const STARTED = Date.now();
const overBudget = () =>
  MAX_MINUTES > 0 && Date.now() - STARTED > MAX_MINUTES * 60_000;

const STYLE_RULES = [
  "You are the senior travel writer at Sunday Atlas Travel, a company based in Bangkok that plans and runs its own private tours in Central Asia, the Caucasus and northeast China.",
  "Write practical, specific, experienced travel guidance in clear US English for independent travellers who are researching a trip.",
  "Hard rules:",
  "- Never use the words tailor-made, bespoke or curated.",
  "- Never name other companies, booking platforms or travel agencies, and never describe Sunday Atlas Travel as an agent, reseller or partner of anyone. No suppliers, local operators or third parties.",
  "- Never write prices, costs, fees or currency amounts of any kind. Verified prices are added separately.",
  "- Do not invent exact dates, timetables, ticket prices or phone numbers. Use seasons, months and typical durations.",
  "- Only say a Sunday Atlas tour visits a place when that place appears in the tour facts you are given.",
  "- Answer first: the first sentence of the intro (under 200 characters) directly answers the question in the title, with a concrete specific such as the best months, a tour length or a drive time. No scene-setting openers (Imagine, Nestled, Welcome, Whether you...).",
  "- Every post needs at least 3 concrete, checkable specifics: tour lengths from the tour facts, drive times, distances, altitudes, opening seasons or month ranges. Use only well-documented figures and round them (about 2 hours, 65 km). Tour prices are added from our catalog with the date they were checked.",
  "- Never invent first-hand experiences, guest stories, quotes, reviews, ratings or star scores. Do not write in the first person singular.",
  '- Use "we" and "our" for Sunday Atlas Travel. No exclamation marks. No emojis. No markdown.',
  "- Return ONLY one valid JSON object, no commentary.",
].join("\n");

/* ------------------------------------------------------------ catalog facts */

function packageFacts(pkg) {
  const days = (pkg.itinerary ?? [])
    .map((d) => `Day ${d.day}: ${d.title?.en ?? ""}`)
    .join("; ");
  return [
    `- slug: ${pkg.slug}`,
    `  title: ${pkg.title?.en}`,
    `  length: ${pkg.durationDays === 1 ? "1-day private tour" : `${pkg.durationDays} days / ${pkg.nights ?? pkg.durationDays - 1} nights, private`}`,
    `  season: ${pkg.seasonNote?.en ?? ""}`,
    `  summary: ${pkg.summary?.en ?? ""}`,
    days ? `  itinerary: ${days}` : "",
    `  includes: ${(pkg.included?.en ?? []).slice(0, 6).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function destinationFacts(dest) {
  if (!dest) return "";
  return [
    `Destination: ${dest.name?.en}`,
    `Best seasons: ${(dest.bestSeasons?.en ?? []).join(" ")}`,
    `Highlights: ${(dest.highlights?.en ?? []).slice(0, 8).join("; ")}`,
    `Visa note: ${dest.visaNote?.en ?? ""}`,
  ].join("\n");
}

/* ------------------------------------------------------------ plain-text section format */

/**
 * Long prose inside JSON strings is where models break JSON, so section bodies use a line
 * format: PARAGRAPH: / HIGHLIGHT: / FACT: label | value / HEADING:.
 */
export function parseSectionText(text) {
  const out = { heading: "", paragraphs: [], highlights: [], keyFacts: [] };
  let last = null;
  const clean = (v) =>
    v
      .replace(/^[\s"'*\-•]+|[\s"'*]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  for (const raw of String(text || "")
    .replace(/```[a-z]*\n?/gi, "")
    .split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      last = null;
      continue;
    }
    const m = line.match(
      /^[*#\s-]*(PARAGRAPH|HIGHLIGHT|FACT|HEADING)\s*\d*\s*[:：]\s*(.*)$/i,
    );
    if (m) {
      const tag = m[1].toUpperCase();
      const value = clean(m[2]);
      if (tag === "PARAGRAPH") {
        out.paragraphs.push(value);
        last = "p";
      } else if (tag === "HIGHLIGHT") {
        if (value) out.highlights.push(value);
        last = null;
      } else if (tag === "FACT") {
        const [label, ...rest] = value.split("|");
        if (label && rest.length)
          out.keyFacts.push({
            label: clean(label),
            value: clean(rest.join("|")),
          });
        last = null;
      } else {
        out.heading = value;
        last = null;
      }
    } else if (last === "p" && out.paragraphs.length) {
      out.paragraphs[out.paragraphs.length - 1] =
        `${out.paragraphs.at(-1)} ${clean(line)}`.trim();
    }
  }
  out.paragraphs = out.paragraphs.filter(Boolean);
  return out;
}

/* ------------------------------------------------------------ mock model */

function mockReply(messages) {
  const user = messages[messages.length - 1].content;
  const filler = (n, seed) =>
    Array.from(
      { length: n },
      (_, i) =>
        `${seed} detail ${i + 1} covers routes, seasons and practical planning for independent travellers`,
    ).join(". ") + ".";
  if (user.includes("TASK: OUTLINE")) {
    const kw = user.match(/Topic keyword: "([^"]+)"/)?.[1] ?? "topic";
    const slugs = [...user.matchAll(/- slug: (\S+)/g)].map((m) => m[1]);
    return JSON.stringify({
      title: `${kw[0].toUpperCase()}${kw.slice(1)}: Day Plan (${YEAR})`,
      subtitle: `A practical look at ${kw}`,
      summary: `Plan ${kw} with routes, seasons, travel times and private day trips, written by the team that runs the tours.`,
      intro: `${kw[0].toUpperCase()}${kw.slice(1)} works best from April to June and September to October, on a 1-day or multi-day private tour. ${filler(5, "Intro")}`,
      seoTitle: `${kw} (${YEAR})`.slice(0, 60),
      seoDescription: `Plan ${kw}: the route day by day, train and drive times, the best months and the private tour that runs it. See the plan.`.padEnd(140, " ").trim(),
      keywords: [
        kw,
        `${kw} ${YEAR}`,
        `${kw} plan`,
        `${kw} tips`,
        `${kw} private tour`,
        `${kw} itinerary`,
      ],
      sections: Array.from({ length: 6 }, (_, i) => ({
        id: `part-${i + 1}`,
        heading: user.includes("ITINERARY POST") ? `Day ${i + 1}: Part ${i + 1}` : `${i + 1}. Part ${i + 1} of ${kw}`,
        placeName: `Part ${i + 1}`,
        packageSlug: slugs[i % Math.max(1, slugs.length)] ?? "",
        brief: "brief",
      })),
      faqs: Array.from({ length: 4 }, (_, i) => ({
        q: `Question ${i + 1} about ${kw}?`,
        a: filler(3, "Answer"),
      })),
    });
  }
  if (user.includes("TASK: INTRO")) return JSON.stringify({ intro: filler(6, "Intro") });
  if (user.includes("TASK: SECTION") || user.includes("TASK: SEASONAL")) {
    return [
      "HEADING: This month",
      `PARAGRAPH: ${filler(5, "Para one")} The drive takes about 2 hours and covers 65 km.`,
      `PARAGRAPH: ${filler(5, "Para two")}`,
      `PARAGRAPH: ${filler(5, "Para three")}`,
      "HIGHLIGHT: Highlight one for planning",
      "HIGHLIGHT: Highlight two for packing",
      "HIGHLIGHT: Highlight three for timing",
      "FACT: Best for | First-time visitors",
      "FACT: Time needed | Half a day",
    ].join("\n");
  }
  if (user.includes("Translate each item.")) {
    const items = JSON.parse(user.slice(user.indexOf("[")));
    if (process.env.BLOG_MOCK_BATCH_FAIL === "1" && items.length > 1)
      return "not json";
    const lang = messages[0].content.match(/Write in (\w+)/)?.[1] ?? "x";
    const prefix = lang === "Japanese" ? "日本語 " : `[${lang}] `;
    return JSON.stringify(
      Object.fromEntries(
        items.map((it) => [
          it.id,
          it.text.replace(/^(\s*\d+[.)]\s*)?/, (m) => m + prefix),
        ]),
      ),
    );
  }
  return "{}";
}

/* ------------------------------------------------------------ translation */

function parseJsonArray(text) {
  const src = String(text || "");
  const a = src.indexOf("[");
  const b = src.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(src.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Accept {id: text}, [{id, text}], {items: [...]}, or {id, text} for a single item. */
function normaliseMapping(parsed, batch) {
  if (!parsed) return null;
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.items)
      ? parsed.items
      : null;
  if (list) {
    const out = {};
    for (const row of list)
      if (row && typeof row.id === "string" && typeof row.text === "string")
        out[row.id] = row.text;
    return out;
  }
  if (
    typeof parsed.id === "string" &&
    typeof parsed.text === "string" &&
    batch.length === 1
  )
    return { [parsed.id]: parsed.text };
  return parsed;
}

/** Recover "id": "text" pairs from a reply that is not valid JSON as a whole. */
function salvageMapping(text, batch) {
  const out = {};
  for (const it of batch) {
    const esc = it.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = String(text).match(
      new RegExp(`"${esc}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
    );
    if (m) {
      try {
        out[it.id] = JSON.parse(`"${m[1]}"`);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ blog translation checks */

const UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const WORD_NUM_RE = new RegExp(
  `\\b(?:(${Object.keys(TENS).join("|")})(?:[- ](${UNITS.slice(1, 10).join("|")}))?|(${UNITS.join("|")})|(hundred)|(midnight)|(noon))\\b`,
  "gi",
);

/** Values the English spells out in words ("ten-minute", "twenty to thirty", "midnight"). */
function spelledNumbers(english) {
  const values = [];
  for (const m of String(english).matchAll(WORD_NUM_RE)) {
    if (m[1])
      values.push([
        TENS[m[1].toLowerCase()] +
          (m[2] ? UNITS.indexOf(m[2].toLowerCase()) : 0),
      ]);
    else if (m[3]) values.push([UNITS.indexOf(m[3].toLowerCase())]);
    else if (m[4]) values.push([100]);
    else if (m[5]) values.push([0, 12, 24]);
    else if (m[6]) values.push([12]);
  }
  // Fractions: "two-thirds" → 3分の2, "a quarter" → 1/4, "half" → 1/2.
  for (const m of String(english).matchAll(
    /\b(half|halves|thirds?|quarters?|fourths?|fifths?)\b/gi,
  )) {
    const w = m[1].toLowerCase();
    values.push([
      w.startsWith("hal")
        ? 2
        : w.startsWith("third")
          ? 3
          : w.startsWith("fifth")
            ? 5
            : 4,
    ]);
  }
  // Compounds and decades: "two hundred" → 200, "three thousand" → 3000, "low twenties" → 20s.
  for (const v of compoundSpelled(english)) values.push([v]);
  for (const m of String(english).matchAll(
    /\b(twent|thirt|fort|fift|sixt|sevent|eight|ninet)ies\b/gi,
  )) {
    const base = TENS[`${m[1].toLowerCase()}y`];
    for (let k = 0; k < 10; k += 1) values.push([base + k]);
  }
  if (/\bdozens?\b/i.test(english)) values.push([12]);
  if (/\byear[\s-]round\b|\ball year\b|\bevery day of the year\b|\b24\/7\b|around-the-clock/i.test(english))
    values.push([365]);
  return values;
}

const SMALL_WORDS = Object.fromEntries(UNITS.map((w, i) => [w, i]));
/** Multi-word English numbers ("two hundred and fifty", "three thousand", "forty-five"). */
function compoundSpelled(english) {
  const words = String(english).toLowerCase().match(/[a-z]+/g) || [];
  const found = [];
  let total = 0;
  let cur = 0;
  let active = false;
  let multi = false;
  const flush = () => {
    if (active && multi) found.push(total + cur);
    total = 0;
    cur = 0;
    active = false;
    multi = false;
  };
  for (const w of words) {
    if (w in SMALL_WORDS) {
      if (active && cur % 10 !== 0) flush();
      if (active) multi = true;
      cur += SMALL_WORDS[w];
      active = true;
    } else if (w in TENS) {
      if (active && cur % 100 !== 0) flush();
      if (active) multi = true;
      cur += TENS[w];
      active = true;
    } else if (w === "hundred" || w === "hundreds") {
      cur = (cur || 1) * 100;
      multi = active;
      active = true;
    } else if (w === "thousand" || w === "thousands") {
      total += (cur || 1) * 1000;
      cur = 0;
      multi = true;
      active = true;
    } else if (w === "and" && active) {
      /* "two hundred and fifty" */
    } else flush();
  }
  flush();
  return found;
}

const ROMAN = { I: 1, V: 5, X: 10 };
function romanToInt(r) {
  let total = 0;
  for (let i = 0; i < r.length; i += 1) {
    const v = ROMAN[r[i]];
    const next = ROMAN[r[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/* Kanji numerals: 二十五 → 25, 三千 → 3000, 二〇二六 → 2026, 1万 → 10000, 2時間半 → 2.5時間. */
const KANJI_DIGIT = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const KANJI_UNIT = { 十: 10, 百: 100, 千: 1000 };
const JA_COUNTER =
  "(?:十|百|千|万|時間|時|分|秒|日|泊|人|名|つ|回|度|年|世紀|か所|ヶ所|カ所|か月|ヶ月|カ月|週|月|キロ|メートル|km|m|階|駅|品|種類|本|杯|枚|軒|台|番目|番|号)";
function kanjiToInt(run) {
  if (/[〇零]/.test(run) || !/[十百千万]/.test(run))
    return Number([...run].map((c) => KANJI_DIGIT[c] ?? "").join(""));
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const c of run) {
    if (c in KANJI_DIGIT) digit = KANJI_DIGIT[c];
    else if (c in KANJI_UNIT) {
      section += (digit || 1) * KANJI_UNIT[c];
      digit = 0;
    } else if (c === "万") {
      total += (section + digit || 1) * 10000;
      section = 0;
      digit = 0;
    }
  }
  return total + section + digit;
}

export function normaliseJapaneseNumerals(text) {
  let t = String(text ?? "").normalize("NFKC");
  // Kanji runs: keep a lone 一 unless a counter follows (一部, 一緒, 唯一 are words, not numbers).
  t = t.replace(/[〇零一二三四五六七八九十百千万]+/g, (run, offset, str) => {
    if (run === "一" || run === "万") {
      const after = str.slice(offset + run.length, offset + run.length + 4);
      if (run === "万" || !new RegExp(`^${JA_COUNTER}`).test(after)) return run;
    }
    if (
      run === "十" &&
      str.slice(offset + 1, offset + 2) === "分" &&
      !/\d$/.test(str.slice(0, offset))
    )
      return run; // 十分 = "enough"
    const v = kanjiToInt(run);
    return Number.isFinite(v) && v > 0 ? String(v) : run;
  });
  // 1万 / 1.5万 / 3万5000 → plain integers.
  t = t.replace(/(\d+(?:\.\d+)?)万(\d{1,4})?/g, (_, a, b) =>
    String(Math.round(Number(a) * 10000) + Number(b || 0)),
  );
  t = t.replace(/(\d+)時間半/g, "$1.5時間").replace(/(\d{1,2})時半/g, "$1:30");
  return t;
}

/** Number words in de/fr/es output, for the cases where the model spelled a digit out. */
const LOCALE_NUMBER_WORDS = {
  de: {
    zwei: 2,
    drei: 3,
    vier: 4,
    fünf: 5,
    sechs: 6,
    sieben: 7,
    acht: 8,
    neun: 9,
    zehn: 10,
    elf: 11,
    zwölf: 12,
    fünfzehn: 15,
    zwanzig: 20,
    dreißig: 30,
    vierzig: 40,
    fünfzig: 50,
    sechzig: 60,
    neunzig: 90,
    hundert: 100,
  },
  fr: {
    deux: 2,
    trois: 3,
    quatre: 4,
    cinq: 5,
    six: 6,
    sept: 7,
    huit: 8,
    dix: 10,
    onze: 11,
    douze: 12,
    quinze: 15,
    vingt: 20,
    trente: 30,
    quarante: 40,
    cinquante: 50,
    soixante: 60,
    cent: 100,
  },
  es: {
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    quince: 15,
    veinte: 20,
    treinta: 30,
    cuarenta: 40,
    cincuenta: 50,
    sesenta: 60,
    noventa: 90,
    cien: 100,
  },
};
function localeWordsToDigits(text, locale) {
  const words = LOCALE_NUMBER_WORDS[locale];
  if (!words) return text;
  const re = new RegExp(
    `(?<![\\p{L}])(${Object.keys(words).join("|")})(?=[\\p{L}]{0,10}(?![\\p{L}]))`,
    "giu",
  );
  return String(text).replace(re, (m) => String(words[m.toLowerCase()] ?? m));
}

function romanCenturies(text) {
  return text.replace(
    /\b([IVX]{1,5})(?=(?:e|er|ème|re)?\s*(?:siècle|s\.)|\b)/g,
    (m, r, offset, str) => {
      const before = str.slice(Math.max(0, offset - 8), offset);
      const after = str.slice(offset + m.length, offset + m.length + 10);
      return /^(?:e|er|ème)?\s*siècle/i.test(after) ||
        /^(?:e|er|ème)\b/.test(after) ||
        /siglo\s*$/i.test(before)
        ? String(romanToInt(r))
        : m;
    },
  );
}

/** Output variants to compare: as written, with numerals normalised, and with number words → digits. */
export function outVariants(out, locale) {
  const base = romanCenturies(
    String(out ?? "")
      .normalize("NFKC")
      .replace(/(\d{1,2})[:.h]00\b/g, "$1"),
  );
  const v1 = locale === "ja" ? normaliseJapaneseNumerals(base) : base;
  const v2 = localeWordsToDigits(v1, locale);
  return [...new Set([base, v1, v2])];
}

const noLeadingZero = (n) => n.replace(/^0+(?=\d)/, "");
export function compareNumbers(en, right) {
  const pool = new Map();
  for (const raw of numberMultiset(right)) {
    const n = noLeadingZero(raw);
    pool.set(n, (pool.get(n) || 0) + 1);
  }
  const take = (n) => {
    const c = pool.get(n) || 0;
    if (!c) return false;
    pool.set(n, c - 1);
    return true;
  };
  const pmHours = new Set(
    [
      ...en.matchAll(
        /\b(\d{1,2})(?::\d{2})?\s*(?:(?:-|–|to|and)\s*(\d{1,2})(?::\d{2})?\s*)?(?:pm|p\.m\.)/gi,
      ),
    ].flatMap((m) => [m[1], m[2]].filter(Boolean)),
  );
  const decades = new Set(
    [...en.matchAll(/\b(\d{2})00s\b/g)].map((m) => `${m[1]}00`),
  );
  const missing = [];
  for (const n of numberMultiset(en).map(noLeadingZero)) {
    if (take(n)) continue;
    if (pmHours.has(n) && Number(n) < 12 && take(String(Number(n) + 12)))
      continue;
    if (decades.has(n) && take(String(Number(n.slice(0, 2)) + 1))) continue; // "1800s" → "19世紀"
    missing.push(n);
  }
  const extras = [...pool].flatMap(([n, c]) => Array(c).fill(n));
  return { missing, extras };
}

function extrasExplained(en, extras) {
  const words = spelledNumbers(en);
  let smallAllowance = (
    en.match(
      /\b(?:first|second|third|fourth|fifth|single|double|twin|both|once|twice|half|per|each|a day|a night|overnight|a person|an hour|a week|a year|upstairs|downstairs|floor|weekly|daily|nightly|annual|annually)\b/gi,
    ) || []
  ).length;
  for (const n of extras) {
    const v = Number(n);
    const i = words.findIndex((opts) => opts.includes(v));
    if (i >= 0) {
      words.splice(i, 1);
      continue;
    }
    if (v === 1) continue; // "a", "an", "one-day", 1つ, 1人: a counter of one is never a factual change.
    // Small counters (dates, months, "day three", "two hours ten minutes") are words in English
    // and digits in the translation. Every number written as digits in English is still required.
    if (Number.isInteger(v) && v >= 1 && v <= 31) {
      smallAllowance -= 1;
      continue;
    }
    return false;
  }
  return true;
}

export function englishForNumbers(english) {
  return String(english ?? "")
    .normalize("NFKC")
    .replace(/\b24\/7\b/g, "24 around-the-clock") // 24/7 → 24時間365日 / 24 h/24, 7 j/7
    .replace(/\b(\d{1,2})[:.]00\b/g, "$1");
}

/**
 * The shared numbersPreserved() is strict about digits. Blog prose legitimately turns
 * "6 pm" into "18 Uhr", "ten-minute" into "10分"/"十分", "7th century" into "siglo VII",
 * "10,000" into "1万". Accept those, and nothing else: every English number must still appear
 * (or its 24-hour / century form), and every extra number must be one the English spelled out
 * in words, a counter of one, or a small counter the English implies ("per person" → 1人).
 */
export function blogNumbersOk(english, out, locale = "") {
  const en = englishForNumbers(english);
  return outVariants(out, locale).some((right) => {
    const { missing, extras } = compareNumbers(en, right);
    return missing.length === 0 && extrasExplained(en, extras);
  });
}

/** Every English number is present in the translation (extras allowed). Used only for the per-field fallback. */
export function englishNumbersKept(english, out, locale = "") {
  const en = englishForNumbers(english);
  return outVariants(out, locale).some((right) => {
    const { missing, extras } = compareNumbers(en, right);
    // Extras may not be large numbers (years, distances, prices): those would be new facts.
    return missing.length === 0 && extras.every((n) => Number(n) <= 31);
  });
}

/** Shared validator, with blog-specific number handling. Blog fields are plain text, not markdown. */
export function validateBlogTranslation(english, value, locale) {
  const check = validateTranslation(english, value, locale);
  if (check.ok) return check;
  const reasons = check.reasons.filter((r) => {
    if (r === "numbers differ") return !blogNumbersOk(english, value, locale);
    if (r === "list lines differ" || r === "heading lines differ") return false;
    if (r === "missing CJK characters" && noTranslatableWords(english))
      return false;
    if (r === "brand wording") return BRAND_RE.test(brandNeutral(value));
    return true;
  });
  return { ok: reasons.length === 0, reasons };
}

export { brandNeutral };

/**
 * Some models answer a plain-text request with {"<source>": "<translation>"}, sometimes one
 * key per English sentence. Keep the translation: a single value as-is, several values joined
 * in order when every key is a piece of the English source (or the values are the only content).
 */
export function unwrapSingleValue(text, english = "", locale = "") {
  const t = String(text ?? "").trim();
  if (!/^(?:```(?:json)?\s*)?[{[]/.test(t)) return t;
  const obj = parseJsonObject(t) ?? parseJsonArray(t);
  if (!obj || typeof obj !== "object") return t;
  const entries = (Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj))
    .map(([k, v]) => [k, v && typeof v === "object" && typeof v.text === "string" ? v.text : v])
    .filter(([, v]) => typeof v === "string" && v.trim());
  if (entries.length === 1) return entries[0][1].trim();
  if (entries.length > 1) {
    const src = String(english ?? "").replace(/\s+/g, " ");
    const keysFromSource =
      Array.isArray(obj) ||
      entries.every(([k]) => src.includes(String(k).replace(/\s+/g, " ").trim()));
    if (keysFromSource)
      return entries
        .map(([, v]) => v.trim())
        .join(locale === "ja" ? "" : " ");
  }
  return t;
}

/** Split English prose into sentences (keeps "e.g.", "a.m.", decimals and "St." together). */
export function splitSentences(text) {
  const src = String(text ?? "").trim();
  const parts = src
    .replace(/\b(e\.g|i\.e|a\.m|p\.m|St|Mt|Dr|approx|vs|etc)\./gi, (m) => m.replace(/\./g, "\u0000"))
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/)
    .map((p) => p.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
  return parts.length ? parts : [src];
}

/** Values with no translatable words ("4 km", "18-22°C", "2h 10min") may stay as written in every locale. */
export function noTranslatableWords(english) {
  const residue = String(english ?? "")
    .normalize("NFKC")
    .replace(/(?<!\p{L})(?:km|kms|m|cm|mm|kg|g|l|ml|h|hr|hrs|min|mins|C|F|am|pm|USD|EUR|AED|US)(?!\p{L})/giu, " ")
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
  return residue === "";
}

/** Per-locale glossary: brand voice words and number formatting, appended to the translate prompt. */
export function translateGlossary(locale) {
  const never = {
    de: '"maßgeschneidert", "massgeschneidert", "Partner", "Partnerunternehmen", "Veranstalter vor Ort", "lokale Anbieter", "Drittanbieter", "Vermittler", "Lieferant"',
    fr: '"sur mesure", "sur-mesure", "partenaire(s)", "tiers" (for "third party"), "opérateur local", "intermédiaire", "revendeur", "fournisseur"',
    ja: '"オーダーメイド", "テーラーメイド", "厳選", "提携", "現地パートナー", "代理店", "仲介"',
    es: '"a medida", "hecho a medida", "socios locales", "operadores locales", "terceros", "intermediarios", "revendedor", "proveedor"',
  }[locale];
  const instead = {
    de: '"privat", "individuell geplant", "unser Team vor Ort"',
    fr: '"privé", "personnalisé", "notre équipe sur place"',
    ja: '"プライベート", "ご希望に合わせた", "現地スタッフ"',
    es: '"privado", "personalizado", "nuestro equipo local"',
  }[locale];
  return [
    `Glossary (mandatory): never write ${never ?? "words meaning tailor-made, bespoke, curated, partner, supplier or third party"}; use ${instead ?? "plain wording"} instead.`,
    `Never mention other companies, partners, suppliers or third parties. Keep "Sunday Atlas Travel" exactly as written, untranslated.`,
    `Numbers: copy every number from the English as Arabic digits (0-9) with the same value. Never spell a digit out as a word, kanji numeral or Roman numeral, never convert units or clock formats, and do not add numbers that are not in the English`,
    `(e.g. "10-minute" → "10-minütige" / "de 10 minutes" / "10分" / "de 10 minutos"; "16th-century" → "16. Jahrhundert" / "16e siècle" / "16世紀" / "siglo 16").`,
  ].join(" ");
}

/** Fields where the English source is an acceptable last resort (short labels and headings). */
const ENGLISH_OK_FIELD =
  /^(?:s\d+\.(?:heading|place|h\d+|f\d+\.l)|kw\d+|q\d+|alt\d+|img\d+)$/;

/**
 * Last resort for one field after every retry failed. Never accepts banned/supplier/brand wording
 * (callers' gates also block invented prices across every locale).
 *   - a translation whose only problem is numbers, where every English number is still present
 *     (only extra small numbers like counters were added) → keep that translation;
 *   - short labels/headings → the English source text.
 */
export function fieldFallback(it, candidates, locale) {
  const english = String(it.text ?? "");
  if (
    BANNED_RE.test(english) ||
    SUPPLIER_RE.test(english) ||
    BRAND_RE.test(english)
  )
    return null;
  for (const c of candidates) {
    if (
      c.reasons.length === 1 &&
      c.reasons[0] === "numbers differ" &&
      englishNumbersKept(english, c.value, locale)
    )
      return {
        kind: "kept translation with extra numbers",
        value: c.value.trim(),
      };
  }
  if (ENGLISH_OK_FIELD.test(it.id))
    return { kind: "English source", value: english };
  return null;
}

/** Workers AI m2m100 for one string, accepted only if it passes every translation check. */
async function m2mChecked(english, locale) {
  const raw = await translateM2M(english, locale);
  if (!raw) return null;
  const check = validateBlogTranslation(english, raw, locale);
  if (!check.ok || BANNED_RE.test(raw) || SUPPLIER_RE.test(raw)) return null;
  return raw.trim();
}

/**
 * The writer sometimes repeats its own instructions as copy ("No other companies, booking
 * platforms or third parties are involved."). Drop such sentences from English paragraphs
 * before translation so the reseller/banned/supplier gates never see them.
 */
export function withoutRuleSentences(paragraph) {
  const bad = (t) =>
    BRAND_RE.test(brandNeutral(t)) || BANNED_RE.test(t) || SUPPLIER_RE.test(t);
  if (!bad(paragraph)) return paragraph;
  return splitSentences(paragraph)
    .filter((t) => !bad(t))
    .join(" ")
    .trim();
}

/** Paragraph fields: "s2.p3" (post body) or "p1" (seasonal section). */
export const PARAGRAPH_FIELD = /^(?:s\d+\.)?p\d+$/;

/** Sentence-by-sentence translation of one failing field. Returns the joined text or null. */
async function translateBySentence(it, locale, system, context) {
  const sentences = splitSentences(it.text);
  if (sentences.length < 2) return null;
  const models = process.env.NVIDIA_API_KEY ? translateModelsFor(locale) : [];
  const parts = await Promise.all(sentences.map(async (sentence) => {
    let good = null;
    let check = { ok: false, reasons: [] };
    for (let attempt = 1; attempt <= 3 && !good; attempt += 1) {
      const pinned = numberMultiset(sentence);
      const feedback =
        attempt === 1
          ? ""
          : `\nYour previous translation failed these checks: ${check.reasons.join(", ")}. ` +
            `The English contains exactly these numbers: ${pinned.join(", ") || "(none)"}. Write each once as Arabic digits (0-9); add no other number.`;
      let value = "";
      try {
        const { text } = await chat({
          model: attempt === 2 && models[1] ? models[1] : TRANSLATE_MODEL,
          locale,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: `Context: ${context}\nTranslate this one sentence into the target language. Reply with the translation only, plain text, no JSON, no tags, no notes.${feedback}\n<text>${sentence}</text>`,
            },
          ],
          max_tokens: 600,
          temperature: attempt === 3 ? 0 : 0.2,
          mock: (msgs) =>
            mockReply([
              { role: "system", content: msgs[0].content },
              {
                role: "user",
                content: `Translate each item.\n${JSON.stringify([{ id: "x", text: sentence }])}`,
              },
            ]).replace(/^\{"x":"|"\}$/g, ""),
        });
        value = unwrapSingleValue(text.replace(/<\/?text>/g, "").trim(), sentence, locale);
      } catch (err) {
        if (err?.fatal) throw err;
      }
      check = validateBlogTranslation(sentence, value, locale);
      if (BANNED_RE.test(value) || SUPPLIER_RE.test(value))
        check = { ok: false, reasons: [...check.reasons, "banned word"] };
      if (check.ok) good = value.trim();
    }
    if (!good) good = await m2mChecked(sentence, locale);
    return good;
  }));
  if (parts.some((p) => !p)) return null;
  const joined = parts.join(locale === "ja" ? "" : " ");
  const whole = validateBlogTranslation(it.text, joined, locale);
  return whole.ok ? joined : null;
}

function logFieldFailure(locale, it, value) {
  console.log(`    · ${locale}:${it.id} EN: ${String(it.text).slice(0, 600)}`);
  console.log(
    `      ${locale}:${it.id} OUT: ${String(value ?? "").slice(0, 600)}`,
  );
}

/** Batch rounds for one locale: JSON batches, all batches of a round in flight at once. */
async function translateBatches(locale, items, system, context, out) {
  let pending = items;
  const rounds = [
    [1, 20, 4000],
    [2, 5, 1500],
  ];
  for (const [round, maxItems, maxChars] of rounds) {
    if (pending.length === 0) break;
    const batches = packBatches(pending, maxItems, maxChars);
    const results = await Promise.all(
      batches.map(async (batch) => {
        const user = `Context: ${context}\nTranslate each item.\n${JSON.stringify(batch.map(({ id, text }) => ({ id, text })))}`;
        let mapping = {};
        try {
          const { text } = await chat({
            model: TRANSLATE_MODEL,
            locale,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            max_tokens: 4096,
            temperature: 0.2,
            mock: mockReply,
          });
          mapping =
            normaliseMapping(
              parseJsonObject(text) ?? parseJsonArray(text),
              batch,
            ) ?? salvageMapping(text, batch);
          if (
            process.env.BLOG_DEBUG &&
            Object.keys(mapping).length < batch.length
          ) {
            console.log(
              `    [debug] ${locale} r${round} got ${Object.keys(mapping).length}/${batch.length}: ${text.slice(0, 300)}`,
            );
          }
        } catch (err) {
          if (err?.fatal) throw err;
          console.log(
            `    ⚠ translate ${locale} batch failed: ${err.message || err}`,
          );
        }
        const failed = [];
        for (const it of batch) {
          let value = mapping[it.id];
          if (
            value &&
            typeof value === "object" &&
            typeof value.text === "string"
          )
            value = value.text;
          else if (value && typeof value === "object")
            value = unwrapSingleValue(JSON.stringify(value), it.text, locale);
          else if (typeof value === "string")
            value = unwrapSingleValue(value, it.text, locale);
          const check = validateBlogTranslation(it.text, value, locale);
          const banned =
            typeof value === "string" &&
            (BANNED_RE.test(value) || SUPPLIER_RE.test(value));
          if (check.ok && !banned) out[it.id] = value.trim();
          else
            failed.push({
              ...it,
              reasons: banned ? ["banned word"] : check.reasons,
            });
        }
        return failed;
      }),
    );
    pending = results.flat(); // batch order, then item order: deterministic
  }
  return pending;
}

/**
 * Fallback ladder for ONE field that failed the batch rounds:
 *   1. plain request   2. same model, pinned numbers   3. the language's second model, pinned numbers
 *   4. minimal literal translation, temperature 0   5. sentence by sentence (m2m100 per sentence)
 *   6. Workers AI m2m100 for the field   7. fieldFallback (short labels)   else: failed.
 * Returns { value, fallback } or { failed: reasons, lastValue }.
 */
async function translateFieldLadder(it, locale, system, context) {
  const models = process.env.NVIDIA_API_KEY ? translateModelsFor(locale) : [];
  let value = "";
  let check = { ok: false, reasons: [] };
  const candidates = [];
  for (let attempt = 1; attempt <= 4 && !check.ok; attempt += 1) {
    const pinned = numberMultiset(it.text);
    const feedback =
      attempt === 1
        ? ""
        : `\nYour previous translation failed these checks: ${check.reasons.join(", ")}. ` +
          `The English contains exactly these numbers: ${pinned.join(", ") || "(none)"}. Write each of them once, as Arabic digits (0-9), ` +
          `not as words or kanji numerals; do not add any other number, and do not convert units or clock formats.`;
    const literal =
      attempt === 4
        ? "\nGive a minimal, literal, sentence-by-sentence translation. Do not paraphrase, add or drop anything."
        : "";
    value = "";
    try {
      const { text } = await chat({
        // Third try goes to the language's other model (a second opinion, not a retry of the same one).
        model: attempt === 3 && models[1] ? models[1] : TRANSLATE_MODEL,
        locale,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Context: ${context}\nTranslate the text between <text> tags. Reply with the translation only, no tags, no notes.${feedback}${literal}\n<text>${it.text}</text>`,
          },
        ],
        max_tokens: 1500,
        temperature: attempt === 4 ? 0 : 0.2,
        mock: (msgs) =>
          mockReply([
            { role: "system", content: msgs[0].content },
            {
              role: "user",
              content: `Translate each item.\n${JSON.stringify([{ id: "x", text: it.text }])}`,
            },
          ]).replace(/^\{"x":"|"\}$/g, ""),
      });
      value = unwrapSingleValue(
        text.replace(/<\/?text>/g, "").trim(),
        it.text,
        locale,
      );
    } catch (err) {
      if (err?.fatal) throw err;
    }
    check = validateBlogTranslation(it.text, value, locale);
    if (BANNED_RE.test(value) || SUPPLIER_RE.test(value))
      check = { ok: false, reasons: [...check.reasons, "banned word"] };
    if (value) candidates.push({ value, reasons: check.reasons });
  }
  if (check.ok) return { value };
  const why = check.reasons.join(", ");
  // Paragraph still failing: translate it one sentence at a time (short inputs keep the
  // models literal), check every sentence, then check the joined paragraph again.
  const rescued = await translateBySentence(it, locale, system, context);
  if (rescued) {
    console.log(`    ↪ ${locale}:${it.id} rescued sentence by sentence (${why})`);
    return { value: rescued, fallback: `${locale}:${it.id} (sentence by sentence; ${why})` };
  }
  // Workers AI m2m100 for this one field (a few neurons), still fully checked.
  const machine = await m2mChecked(it.text, locale);
  if (machine) {
    console.log(`    ↪ ${locale}:${it.id} rescued with m2m100 (${why})`);
    return { value: machine, fallback: `${locale}:${it.id} (m2m100; ${why})` };
  }
  const fb = fieldFallback(it, candidates, locale);
  if (fb) {
    console.log(`    ↪ ${locale}:${it.id} fallback: ${fb.kind} (${why})`);
    logFieldFailure(locale, it, value);
    return { value: fb.value, fallback: `${locale}:${it.id} (${fb.kind}; ${why})` };
  }
  return { failed: check.reasons, lastValue: value };
}

/** All of one locale: batch rounds, then every failing field's ladder concurrently. */
async function translateLocale(locale, items, context) {
  const system = `${buildSystemPrompt(locale, "translate")} ${translateGlossary(locale)}`;
  const got = {};
  const pending = await translateBatches(locale, items, system, context, got);
  const ladders = await Promise.all(
    pending.map((it) => translateFieldLadder(it, locale, system, context)),
  );
  const failures = [];
  const fallbacks = [];
  const dropped = [];
  pending.forEach((it, i) => {
    const r = ladders[i];
    if (!r.failed) {
      got[it.id] = r.value.trim();
      if (r.fallback) fallbacks.push(r.fallback);
      return;
    }
    logFieldFailure(locale, it, r.lastValue);
    // A paragraph that failed every rung is dropped in this locale only; the caller
    // keeps the post as long as each section still has a paragraph in every locale.
    if (PARAGRAPH_FIELD.test(it.id)) {
      dropped.push({ locale, id: it.id });
      console.log(`    ✂ ${locale}:${it.id} dropped in ${locale} (${r.failed.join(", ")})`);
      return;
    }
    failures.push(`${locale}:${it.id} (${r.failed.join(", ")})`);
  });
  // Deterministic field order regardless of which request finished first.
  const ordered = {};
  for (const it of items) if (it.id in got) ordered[it.id] = got[it.id];
  return { out: ordered, failures, fallbacks, dropped };
}

/**
 * Translate { id: englishText } into every target locale. Locales run concurrently (and fields
 * within a locale too); the shared NVIDIA limiter in blog-ai-client caps requests in flight.
 * Output, failures, fallbacks and dropped are merged in TARGETS order, fields in input order.
 */
export async function translateStrings(strings, context) {
  const out = Object.fromEntries(LOCALES.map((l) => [l, {}]));
  out.en = { ...strings };
  const items = Object.entries(strings)
    .filter(([, t]) => typeof t === "string" && t.trim())
    .map(([id, text]) => ({ id, text, chars: text.length }));
  const perLocale = await Promise.all(
    TARGETS.map((locale) => translateLocale(locale, items, context)),
  );
  const failures = [];
  const fallbacks = [];
  const dropped = [];
  TARGETS.forEach((locale, i) => {
    const r = perLocale[i];
    out[locale] = r.out;
    failures.push(...r.failures);
    fallbacks.push(...r.fallbacks);
    dropped.push(...r.dropped);
  });
  return { out, failures, fallbacks, dropped };
}

/**
 * Paragraph list per locale, without the paragraphs dropped in that locale. Adds a failure when
 * dropping would leave a section with no paragraph in some locale.
 */
export function paragraphLists(keys, tr, dropped, failures, label) {
  const lists = {};
  for (const l of LOCALES) {
    const gone = new Set(dropped.filter((d) => d.locale === l).map((d) => d.id));
    lists[l] = keys.filter((k) => !gone.has(k)).map((k) => tr[l][k] ?? "");
    if (keys.length && lists[l].length === 0)
      failures.push(`${l}:${label} (every paragraph failed)`);
  }
  return lists;
}

/* ------------------------------------------------------------ catalog facts per locale */

/** Duration and starting price rows come from the package catalog, never from the model. */
function catalogKeyFacts(pkg) {
  const d = pkg.durationDays;
  const n = pkg.nights ?? Math.max(0, d - 1);
  const price = pkg.priceFrom;
  const cur = pkg.currency || "USD";
  const duration =
    d === 1
      ? { en: "1 Day", de: "1 Tag", fr: "1 jour", ja: "日帰り", es: "1 día" }
      : {
          en: `${d} Days / ${n} Nights`,
          de: `${d} Tage / ${n} Nächte`,
          fr: `${d} jours / ${n} nuits`,
          ja: `${d}日間 / ${n}泊`,
          es: `${d} días / ${n} noches`,
        };
  const priceValue =
    typeof price === "number"
      ? {
          en: `From $${price} ${cur} / person`,
          de: `Ab $${price} ${cur} / Person`,
          fr: `À partir de $${price} ${cur} / personne`,
          ja: `$${price} ${cur}〜 / 1名`,
          es: `Desde $${price} ${cur} / persona`,
        }
      : {
          en: "Price on request",
          de: "Preis auf Anfrage",
          fr: "Prix sur demande",
          ja: "料金はお問い合わせください",
          es: "Precio a consultar",
        };
  return [
    {
      label: {
        en: "Duration",
        de: "Dauer",
        fr: "Durée",
        ja: "期間",
        es: "Duración",
      },
      value: duration,
    },
    {
      label: {
        en: "Private tour",
        de: "Privattour",
        fr: "Circuit privé",
        ja: "プライベートツアー",
        es: "Tour privado",
      },
      value: priceValue,
    },
  ];
}

/* ------------------------------------------------------------ images */

function imagePool(topic, catalog) {
  const pool = [];
  const seen = new Set();
  const push = (img, alt, from) => {
    if (!img?.src || seen.has(img.src)) return;
    seen.add(img.src);
    pool.push({
      src: img.src,
      width: img.width || 1600,
      height: img.height || 1067,
      alt: alt ?? img.alt ?? {},
      from,
    });
  };
  for (const slug of topic.packages) {
    const pkg = catalog.packages.get(slug);
    if (!pkg) continue;
    push(pkg.image, pkg.image?.alt, slug);
    for (const g of pkg.gallery ?? [])
      push(g.image, g.alt ?? g.image?.alt, slug);
  }
  for (const destSlug of [topic.destination, ...(topic.countries ?? [])]) {
    const dest = catalog.destinations.get(destSlug);
    if (!dest) continue;
    push(dest.image, dest.image?.alt, destSlug);
    for (const g of dest.gallery ?? [])
      push(g.image, g.alt ?? g.image?.alt, destSlug);
  }
  return pool;
}

function localizedAlt(alt, fallback) {
  const out = {};
  for (const l of LOCALES)
    out[l] =
      (alt && typeof alt === "object" ? alt[l] || alt.en : "") || fallback;
  return out;
}

/* ------------------------------------------------------------ generation */

async function generatePost(topic, catalog, existing) {
  const reasons = [];
  const live = topic.packages
    .map((s) => catalog.packages.get(s))
    .filter(isLinkablePackage);
  if (live.length < 2)
    return {
      reasons: [`fewer than 2 live packages for topic (${live.length})`],
    };
  const primary = fixYearLabels(String(topic.keyword || "").trim(), YEAR).text;
  const secondary = (topic.secondary ?? []).filter((k) => typeof k === "string" && k.trim()).map((k) => fixYearLabels(k, YEAR).text).slice(0, 5);
  const questions = (topic.questions ?? []).filter((k) => typeof k === "string" && k.trim()).slice(0, 4);
  const dest = catalog.destinations.get(topic.destination);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).format(new Date());
  const facts = live.map(packageFacts).join("\n");
  const isTop =
    topic.category === "top-places" || /^top \d+/i.test(topic.keyword);

  // 1. Outline
  const keywordBrief = [
    `Primary keyword: "${primary}"`,
    secondary.length ? `Secondary keywords (use each naturally once or twice, in headings or body; never stuff): ${secondary.map((k) => `"${k}"`).join(", ")}` : "",
    questions.length ? `Questions searchers ask (answer each as an H2 section heading or as an FAQ question, reworded into natural English): ${questions.map((k) => `"${k}"`).join(", ")}` : "",
    "Skip any secondary keyword or question about a place or attraction that neither the destination facts nor the tours below cover; never claim a tour visits somewhere it does not. Write place names with their proper spelling, accents and capitals (e.g. Kraków); that still counts as the exact phrase.",
    `SEO placement: the title (H1), the seoDescription and the FIRST sentence of the intro must each contain the exact phrase "${primary}" (case may change, words must not). Natural English, no keyword stuffing: the primary keyword at most 3 times in the intro and FAQs together.`,
    // Standing instruction (also covers queue/template topics when the bank runs low).
    "Write for what travellers actually type into Google: a specific, long-tail planning or booking query (things to do in <place>, <place> itinerary <n> days, best time to visit <place>, <place> in winter, day trip from <city>, is <place> safe, <country> visa for <nationality>, <place> vs <place>, <place> travel cost). Answer that exact query in the first sentence, then cover the follow-up questions a planner has next.",
  ].filter(Boolean).join("\n");
  // Itinerary-intent topics ("uzbekistan itinerary 5 days", "3 days in samarkand"): a real day-by-day plan.
  const itin = itineraryPlan(topic, live, YEAR);
  const outlineUser = [
    "TASK: OUTLINE",
    `Topic keyword: "${topic.keyword}"`,
    keywordBrief,
    itin ? itin.brief : "",
    `Angle: ${topic.angle ?? ""}`,
    `Current month: ${month}`,
    `Target year: ${YEAR}. When a title, heading, keyword or sentence labels the content with a year (e.g. "(${YEAR})", "itinerary ${YEAR}", "updated for ${YEAR}"), use ${YEAR}. Never call the post a "guide" in any language (no "This guide…", "Reiseführer", "guía", "ガイド" for the article); say "this post" or just state the facts. Tour guides (people) are fine. Never write ${YEAR - 1} as the current or target year; only use an earlier year for a real past date or a season range such as winter ${YEAR - 2}–${YEAR - 1}.`,
    destinationFacts(dest),
    "Our tours you can link (only these slugs exist):",
    facts,
    "",
    "Return JSON with exactly these keys:",
    TITLE_RULES(primary, YEAR),
    DESCRIPTION_RULES(primary),
    `{"title": "H1 = the clickable title, max 60 characters, starts with the primary keyword in Title Case, then concrete places/days, one honest hook only if the post delivers it, ends with (${YEAR})${itin ? `, e.g. ${itin.example}` : ""}",`,
    ' "subtitle": "one line, 60-110 characters",',
    ' "summary": "140-170 characters, what the reader gets",',
    ' "intro": "110-140 words; the first sentence (under 200 characters) contains the exact primary keyword and directly answers it with a concrete specific (the route, best months, a tour length, a drive time), then the rest supports it",',
    ' "seoTitle": "identical to title",',
    ' "seoDescription": "140-155 characters: exact primary keyword, a concrete promise of what is inside, who it suits, a soft call to action",',
    ' "keywords": ["6 to 8 real search phrases people type"],',
    ` "sections": [exactly 6 objects {"id": "kebab-case-anchor", "heading": "H2${isTop ? ' starting with its rank, e.g. \\"1. ...\\"' : itin ? ' following the day plan above, e.g. \\"Day 1: Tashkent Old City and Chorsu Bazaar\\"' : ""}", "placeName": "1-4 word short name", "packageSlug": "the most relevant slug from the list above or empty string", "brief": "one sentence on what the section covers"}],`,
    ' "faqs": [exactly 4 objects {"q": "a question people search", "a": "45-70 word answer"}]}',
    "Use at least 3 different package slugs across the sections when they fit the section.",
    "Some tours are price on request: never mention a price, cost figure or currency for any tour.",
  ].join("\n");
  const outlineRes = await chat({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: STYLE_RULES },
      { role: "user", content: outlineUser },
    ],
    max_tokens: 2200,
    temperature: 0.5,
    mock: mockReply,
  });
  const outline = parseJsonObject(outlineRes.text);
  if (
    !outline ||
    !Array.isArray(outline.sections) ||
    outline.sections.length < 5 ||
    !outline.title
  ) {
    return { reasons: ["outline was not valid JSON with 5+ sections"] };
  }
  // 1b. Answer-first intro: one rewrite if the opening does not answer the title.
  const introProblems = () =>
    firstHandProblems({ title: { en: outline.title }, intro: { en: outline.intro ?? "" } }).filter(
      (p) => /intro/.test(p),
    );
  if (introProblems().length) {
    const fix = await chat({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: STYLE_RULES },
        {
          role: "user",
          content: [
            "TASK: INTRO",
            `Title: ${outline.title}`,
            `Current intro: ${outline.intro ?? ""}`,
            `Problem: ${introProblems().join("; ")}`,
            destinationFacts(dest),
            "Rewrite the intro in 110-140 words. The first sentence (under 200 characters) must directly answer the title with a concrete specific (best months, a tour length or a drive time). No prices.",
            'Return JSON {"intro": "..."}',
          ].join("\n"),
        },
      ],
      max_tokens: 600,
      temperature: 0.4,
      mock: mockReply,
    });
    const fixed = parseJsonObject(fix.text);
    if (typeof fixed?.intro === "string" && fixed.intro.trim()) outline.intro = fixed.intro.trim();
  }

  // 1c. Keyword placement: one rewrite of title / meta description / intro if the primary keyword is missing.
  const postSlugForKw = slugify(primary);
  const kwProblems = () =>
    keywordProblems(
      { title: outline.title, slug: postSlugForKw, seoDescription: outline.seoDescription ?? "", intro: outline.intro ?? "" },
      primary,
    );
  if (primary && kwProblems().length) {
    const fix = await chat({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: STYLE_RULES },
        {
          role: "user",
          content: [
            "TASK: KEYWORD FIX",
            `Primary keyword: "${primary}"`,
            `Current title: ${outline.title}`,
            `Current seoDescription: ${outline.seoDescription ?? ""}`,
            `Current intro: ${outline.intro ?? ""}`,
            `Problems: ${kwProblems().join("; ")}`,
            destinationFacts(dest),
            `Rewrite so that the title (max 60 characters, starting with the keyword and ending with (${YEAR})), the seoDescription (140-155 characters) and the FIRST sentence of the intro each contain the exact phrase "${primary}" (case may change, word order and words must not). Keep it natural English. The intro stays 110-140 words and its first sentence (under 200 characters) directly answers the title with a concrete specific. No prices.`,
            'Return JSON {"title": "...", "seoDescription": "...", "intro": "..."}',
          ].join("\n"),
        },
      ],
      max_tokens: 900,
      temperature: 0.3,
      mock: mockReply,
    });
    const fixed = parseJsonObject(fix.text);
    for (const k of ["title", "seoDescription", "intro"])
      if (typeof fixed?.[k] === "string" && fixed[k].trim()) outline[k] = fixed[k].trim();
    if (kwProblems().length) repairTitles(outline, primary, YEAR); // title/description: deterministic fix
    if (kwProblems().length) return { reasons: kwProblems() };
  }

  // 1d. Clickable title: query first, <= 60 characters, concrete, one honest hook, target year;
  // H1 = seo_title so Google keeps our title. A post is never dropped just for its title: after the
  // model's draft, a deterministic repair (trim specifics, add the year, trim the meta description),
  // then up to 2 model rewrites (each repaired again). Only the itinerary day-heading rule and a
  // description the model keeps too short can still fail it. (2-3 Nov: 3 runs, 0 posts, every one
  // rejected for "title is 74 characters (max 60)" after a single rewrite.)
  normalizeTitles(outline, YEAR);
  const titleProblems = () => clickableTitleProblems(outline, primary, YEAR, itin);
  const repair = () => {
    if (titleProblems().length) repairTitles(outline, primary, YEAR);
    normalizeTitles(outline, YEAR);
  };
  if (titleProblems().length) {
    const before = outline.title;
    repair();
    if (outline.title !== before) console.log(`  · title repaired: "${before}" -> "${outline.title}"`);
  }
  for (let round = 1; round <= 2 && titleProblems().length; round += 1) {
    console.log(`  · title/description rewrite ${round}/2: ${titleProblems().join("; ")}`);
    const fix = await chat({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: STYLE_RULES },
        {
          role: "user",
          content: [
            "TASK: TITLE FIX",
            `Primary keyword: "${primary}"`,
            `Current title: ${outline.title}`,
            `Current seoDescription: ${outline.seoDescription ?? ""}`,
            `Section headings: ${(outline.sections ?? []).map((x) => x.heading).join(" | ")}`,
            `Problems: ${titleProblems().join("; ")}`,
            TITLE_RULES(primary, YEAR),
            DESCRIPTION_RULES(primary),
            `Count characters: the title must be ${SEO_TITLE_MAX} characters or fewer INCLUDING " (${YEAR})"; the seoDescription 140-155 characters.`,
            itin ? `${itin.brief}\nTitle shape: ${itin.example}` : "",
            itin ? 'Return JSON {"title": "...", "seoDescription": "...", "sections": [the same 6 sections with day-by-day headings]}' : 'Return JSON {"title": "...", "seoDescription": "..."}',
          ].filter(Boolean).join("\n"),
        },
      ],
      max_tokens: itin ? 1400 : 500,
      temperature: round === 1 ? 0.3 : 0.1,
      mock: mockReply,
    });
    const fixed = parseJsonObject(fix.text);
    for (const k of ["title", "seoDescription"])
      if (typeof fixed?.[k] === "string" && fixed[k].trim()) outline[k] = fixed[k].trim();
    if (itin && Array.isArray(fixed?.sections) && fixed.sections.length >= 5) outline.sections = fixed.sections;
    repair();
  }
  if (titleProblems().length || kwProblems().length) return { reasons: [...titleProblems(), ...kwProblems()] };

  // 2. Sections
  const liveSlugs = new Set(live.map((p) => p.slug));
  const sections = [];
  for (const [i, s] of outline.sections.slice(0, 7).entries()) {
    const slug = liveSlugs.has(s.packageSlug) ? s.packageSlug : "";
    const pkg = slug ? catalog.packages.get(slug) : null;
    const user = [
      "TASK: SECTION",
      `Article title: ${outline.title}`,
      `Topic keyword: "${topic.keyword}"`,
      `Section heading: ${s.heading}`,
      `Section brief: ${s.brief ?? ""}`,
      `Other sections: ${outline.sections.map((x) => x.heading).join(" | ")}`,
      destinationFacts(dest),
      pkg
        ? `Our tour linked in this section:\n${packageFacts(pkg)}`
        : "No tour is linked in this section; do not claim one.",
      "",
      "Write the section body as PLAIN TEXT (not JSON) in exactly this layout, one item per line:",
      "PARAGRAPH: <5-6 full sentences, 90-120 words, concrete details: distances, travel times, what you see, when to go, practical tips>",
      "PARAGRAPH: <...>",
      "PARAGRAPH: <...>",
      "PARAGRAPH: <...>",
      "HIGHLIGHT: <8-16 words>",
      "HIGHLIGHT: <...>",
      "HIGHLIGHT: <...>",
      "FACT: <label, 1-3 words> | <short value, no prices>",
      "FACT: <label> | <value>",
      "Each PARAGRAPH must contain at least one concrete, checkable specific (a drive time, a distance, an altitude, a month range or a tour day from the facts above). Round figures; never invent experiences, guest quotes, reviews or ratings.",
      "Write exactly 4 PARAGRAPH lines, 3 HIGHLIGHT lines and 2 FACT lines. Nothing else.",
    ].join("\n");
    let body = null;
    const messages = [
      { role: "system", content: STYLE_RULES },
      { role: "user", content: user },
    ];
    for (let attempt = 0; attempt < 3 && !body; attempt += 1) {
      const res = await chat({
        model: TEXT_MODEL,
        messages,
        max_tokens: 1400,
        temperature: 0.6,
        mock: mockReply,
      });
      const parsed = parseSectionText(res.text);
      if (process.env.BLOG_DEBUG)
        console.log(
          `    [debug] section ${i + 1} raw: ${res.text.slice(0, 400)}`,
        );
      const paragraphs = Array.isArray(parsed?.paragraphs)
        ? parsed.paragraphs.filter((p) => typeof p === "string" && p.trim())
        : [];
      const words = countWords(paragraphs.join(" "));
      if (paragraphs.length >= 3 && words >= SECTION_MIN_WORDS) {
        body = { ...parsed, paragraphs };
      } else if (attempt < 2) {
        // Ask the model to expand its own draft instead of starting over.
        messages.push({ role: "assistant", content: res.text.slice(0, 6000) });
        messages.push({
          role: "user",
          content: `That is ${words} words in ${paragraphs.length} paragraphs. It must be at least ${SECTION_MIN_WORDS + 60} words in 4 paragraphs. Expand every paragraph to 5-6 full sentences with more concrete, accurate detail (no prices). Return the complete section again in the same PARAGRAPH/HIGHLIGHT/FACT layout.`,
        });
      }
    }
    if (!body)
      return {
        reasons: [`section ${i + 1} too short or invalid after 3 attempts`],
      };
    sections.push({ outline: s, slug, body });
  }

  // Make sure at least 2 different tours are embedded.
  const embedded = new Set(sections.map((s) => s.slug).filter(Boolean));
  for (const pkg of live) {
    if (embedded.size >= Math.min(3, live.length)) break;
    if (embedded.has(pkg.slug)) continue;
    const free = sections.find((s) => !s.slug);
    if (!free) break;
    free.slug = pkg.slug;
    embedded.add(pkg.slug);
  }

  // 3. Assemble English
  const id = (s, i) =>
    slugify(s.outline.id || s.outline.placeName || `section-${i + 1}`) ||
    `section-${i + 1}`;
  const usedIds = new Set();
  const enSections = sections.map((s, i) => {
    let sid = id(s, i);
    while (usedIds.has(sid)) sid = `${sid}-${i + 1}`;
    usedIds.add(sid);
    const pkg = s.slug ? catalog.packages.get(s.slug) : null;
    const facts = (Array.isArray(s.body.keyFacts) ? s.body.keyFacts : [])
      .filter(
        (f) => f && typeof f.label === "string" && typeof f.value === "string",
      )
      .slice(0, 2)
      .map((f) => ({ label: f.label.trim(), value: f.value.trim() }));
    const catalogFacts = pkg ? catalogKeyFacts(pkg) : [];
    return {
      id: sid,
      ...(isTop ? { rankNumber: i + 1 } : {}),
      placeName: String(s.outline.placeName || "").trim(),
      heading: String(s.outline.heading || "").trim(),
      paragraphs: s.body.paragraphs
        .map((p) => withoutRuleSentences(p.trim()))
        .filter(Boolean),
      highlights: (Array.isArray(s.body.highlights) ? s.body.highlights : [])
        .filter((h) => typeof h === "string")
        .slice(0, 4),
      keyFacts: facts,
      catalogFacts,
      ...(pkg ? { embeddedPackageSlug: pkg.slug } : {}),
    };
  });
  const faqs = (outline.faqs ?? [])
    .filter((f) => f && typeof f.q === "string" && typeof f.a === "string")
    .slice(0, 5);
  // Primary keyword first (it becomes focus_keyword), then the researched secondaries, then the model's.
  const keywords = [];
  for (const k of [primary, ...secondary, ...(outline.keywords ?? [])]) {
    if (typeof k !== "string" || !k.trim()) continue;
    if (keywords.some((x) => x.toLowerCase() === k.trim().toLowerCase())) continue;
    keywords.push(k.trim());
  }
  keywords.splice(8);

  // 3b. New photos for this post (searched, vision-gated and uploaded while the text is translated)
  const postSlug = slugify(primary || topic.slug || topic.id);
  const imagesPromise = IMAGE_FINDER && imageFinderStatus().enabled
    ? pickPostImages({
        slug: postSlug,
        keyword: topic.keyword,
        country: dest?.name?.en ?? topic.destination,
        sections: enSections.map((s) => ({ id: s.id, placeName: s.placeName, heading: s.heading })),
        registry: REGISTRY,
        log: (m) => console.log(m),
      }).catch((err) => {
        console.log(`    ⚠ image finder failed: ${err.message || err}`);
        return null;
      })
    : Promise.resolve(null);
  PENDING_IMAGES = imagesPromise;

  // 4. Translate everything
  const strings = {
    title: outline.title,
    subtitle: outline.subtitle ?? "",
    summary: outline.summary ?? "",
    intro: outline.intro ?? "",
    seoTitle: outline.seoTitle ?? outline.title,
    seoDescription: outline.seoDescription ?? outline.summary ?? "",
  };
  keywords.forEach((k, i) => (strings[`kw${i}`] = k));
  enSections.forEach((s, i) => {
    strings[`s${i}.heading`] = s.heading;
    strings[`s${i}.place`] = s.placeName;
    s.paragraphs.forEach((p, j) => (strings[`s${i}.p${j}`] = p));
    s.highlights.forEach((h, j) => (strings[`s${i}.h${j}`] = h));
    s.keyFacts.forEach((f, j) => {
      strings[`s${i}.f${j}.l`] = f.label;
      strings[`s${i}.f${j}.v`] = f.value;
    });
  });
  faqs.forEach((f, i) => {
    strings[`q${i}`] = f.q;
    strings[`a${i}`] = f.a;
  });
  const { out: tr, failures, dropped } = await translateStrings(
    strings,
    "travel blog article",
  );
  const paraLists = enSections.map((s, i) =>
    paragraphLists(
      s.paragraphs.map((_, j) => `s${i}.p${j}`),
      tr,
      dropped,
      failures,
      `s${i} paragraphs`,
    ),
  );
  if (dropped.length)
    console.log(
      `    ✂ dropped ${dropped.length} paragraph(s) in one locale each: ${dropped.map((d) => `${d.locale}:${d.id}`).join(", ")}`,
    );
  if (failures.length)
    reasons.push(
      `translation failed for ${failures.length} field(s): ${failures.slice(0, 5).join("; ")}`,
    );

  const loc = (key) =>
    Object.fromEntries(LOCALES.map((l) => [l, tr[l][key] ?? ""]));
  const locList = (keys) =>
    Object.fromEntries(
      LOCALES.map((l) => [l, keys.map((k) => tr[l][k] ?? "")]),
    );

  // 5. Images: new photos from the image finder; catalog photos only for slots it could not fill.
  const found = await imagesPromise;
  if (found) for (const line of found.log) console.log(`    🖼 ${line}`);
  const altStrings = {};
  if (found?.hero) altStrings.hero = found.hero.altEn;
  (found?.inline ?? []).forEach((img, i) => img && (altStrings[`s${i}`] = img.altEn));
  let altTr = Object.fromEntries(LOCALES.map((l) => [l, {}]));
  if (Object.keys(altStrings).length) {
    try {
      altTr = (await translateStrings(altStrings, "photo alt text for a travel article")).out;
    } catch (err) {
      console.log(`    ⚠ alt text translation failed, English alt kept: ${err.message || err}`);
    }
  }
  const altLoc = (key, en) =>
    Object.fromEntries(LOCALES.map((l) => [l, (l === "en" ? en : altTr[l]?.[key]) || en]));
  const finderImage = (img, key) => ({
    src: img.src,
    width: img.width,
    height: img.height,
    alt: altLoc(key, img.altEn),
    ...(img.credit ? { credit: img.credit } : {}),
  });
  // Fallback pool: catalog photos, those not yet in any blog first.
  const inBlogs = new Set(
    REGISTRY.images
      .filter((e) => (e.uses ?? []).some((u) => u.type === "blog"))
      .map((e) => e.cloudinary?.url ?? e.hotlink),
  );
  const pool = imagePool(topic, catalog).sort(
    (a, b) => Number(inBlogs.has(a.src)) - Number(inBlogs.has(b.src)),
  );
  const usedHeroes = new Set(
    existing.map((e) => e.post.heroImage?.src).filter(Boolean),
  );
  let hero = null;
  if (found?.hero) hero = finderImage(found.hero, "hero");
  else if (pool.length) {
    const heroIdx = Math.max(0, pool.findIndex((p) => !usedHeroes.has(p.src)));
    const p = pool.splice(heroIdx, 1)[0];
    hero = { src: p.src, width: p.width, height: p.height, alt: localizedAlt(p.alt, outline.title), fallback: true };
  }
  const sectionImages = enSections.map((s, i) => {
    if (found?.inline?.[i]) return finderImage(found.inline[i], `s${i}`);
    const idx = pool.findIndex((p) => p.from === s.embeddedPackageSlug);
    const pick = idx >= 0 ? pool.splice(idx, 1)[0] : pool.shift();
    return pick
      ? { src: pick.src, width: pick.width, height: pick.height, alt: localizedAlt(pick.alt, s.placeName), fallback: true }
      : null;
  });
  const fallbackCount = [hero, ...sectionImages].filter((x) => x?.fallback).length;
  if (fallbackCount) console.log(`    ↩ ${fallbackCount} image slot(s) used catalog photos (${found ? "finder found nothing new" : "finder off"})`);
  // Register catalog photos used by this post (new finder photos are registered by the finder).
  const useOf = (img, field) => {
    if (!img?.fallback) return;
    const e = findBySrc(REGISTRY, img.src);
    if (e) e.uses = [...(e.uses ?? []), { type: "blog", slug: postSlug, field }];
  };
  useOf(hero, "heroImage");
  sectionImages.forEach((img, i) => useOf(img, `sections.${enSections[i].id}.image`));
  const stripFallback = ({ fallback, ...img }) => img;

  const now = nowIso();
  const slug = postSlug;
  const post = {
    slug,
    published: true,
    featured: false,
    category: [
      "top-places",
      "destination-guide",
      "day-trips",
      "seasonal",
    ].includes(topic.category)
      ? topic.category
      : "destination-guide",
    destination: topic.destination,
    countries: topic.countries ?? [],
    publishedAt: now,
    updatedAt: now,
    readingTimeMinutes: 0,
    relatedPackages: live.map((p) => p.slug).slice(0, 4),
    title: loc("title"),
    subtitle: loc("subtitle"),
    summary: loc("summary"),
    intro: loc("intro"),
    ...(hero ? { heroImage: stripFallback(hero) } : {}),
    sections: enSections.map((s, i) => {
      const img = sectionImages[i];
      return {
        id: s.id,
        ...(s.rankNumber ? { rankNumber: s.rankNumber } : {}),
        placeName: loc(`s${i}.place`),
        heading: loc(`s${i}.heading`),
        paragraphs: paraLists[i],
        highlights: locList(s.highlights.map((_, j) => `s${i}.h${j}`)),
        keyFacts: [
          ...s.keyFacts.map((_, j) => ({
            label: loc(`s${i}.f${j}.l`),
            value: loc(`s${i}.f${j}.v`),
          })),
          ...s.catalogFacts,
        ],
        ...(img
          ? {
              image: {
                ...stripFallback(img),
                caption: loc(`s${i}.place`),
              },
            }
          : {}),
        ...(s.embeddedPackageSlug
          ? { embeddedPackageSlug: s.embeddedPackageSlug }
          : {}),
      };
    }),
    faqs: faqs.map((_, i) => ({ q: loc(`q${i}`), a: loc(`a${i}`) })),
    seo: Object.fromEntries(
      LOCALES.map((l) => [
        l,
        {
          seo_title: tr[l].seoTitle ?? "",
          meta_description: tr[l].seoDescription ?? "",
          focus_keyword: l === "en" ? primary || (tr[l].kw0 ?? "") : (tr[l].kw0 ?? ""),
          keywords: keywords.map((_, i) => tr[l][`kw${i}`]).filter(Boolean),
        },
      ]),
    ),
  };
  post.readingTimeMinutes = readingMinutes(post);
  post.contentHash = contentHash(post);
  reasons.push(...qualityGates(post, catalog, existing));
  // Freshness guard: rewrite any stale year label (e.g. "2026 Guide" when the target is 2027); keeps real dates and slugs.
  const yearFixes = fixYearLabelsDeep(post, YEAR);
  if (yearFixes) console.log(`  [year] rewrote ${yearFixes} stale ${YEAR - 1} label(s) to ${YEAR} in ${post.slug}`);
  return { post, reasons };
}

/* ------------------------------------------------------------ quality gates */

export function qualityGates(post, catalog, existing) {
  const problems = [];
  const words = englishWordCount(post);
  if (words < MIN_WORDS)
    problems.push(`only ${words} English words (min ${MIN_WORDS})`);
  const linked = new Set([
    ...(post.relatedPackages ?? []),
    ...(post.sections ?? []).map((s) => s.embeddedPackageSlug).filter(Boolean),
  ]);
  const liveLinked = [...linked].filter((s) =>
    isLinkablePackage(catalog.packages.get(s)),
  );
  if (liveLinked.length !== linked.size)
    problems.push("links to a package that is not live");
  const embeddedCards = new Set(
    (post.sections ?? []).map((s) => s.embeddedPackageSlug).filter(Boolean),
  );
  if (embeddedCards.size < 2)
    problems.push(`only ${embeddedCards.size} tour card(s) embedded (min 2)`);
  if (!post.heroImage?.src) problems.push("no hero image");
  const inline = (post.sections ?? []).filter((s) => s.image?.src).length;
  if (inline < 2) problems.push(`only ${inline} inline image(s) (min 2)`);
  for (const field of ["title", "summary", "intro"]) {
    for (const l of LOCALES)
      if (!post[field]?.[l]?.trim()) problems.push(`missing ${field}.${l}`);
  }
  for (const [i, s] of (post.sections ?? []).entries()) {
    for (const l of LOCALES) {
      if (!s.heading?.[l]?.trim())
        problems.push(`missing sections.${i}.heading.${l}`);
      if (
        !(s.paragraphs?.[l] ?? []).length ||
        s.paragraphs[l].some((p) => !p?.trim())
      )
        problems.push(`missing sections.${i}.paragraphs.${l}`);
    }
  }
  for (const l of LOCALES) {
    if (!post.seo?.[l]?.seo_title || !post.seo?.[l]?.meta_description)
      problems.push(`missing seo.${l}`);
  }
  problems.push(...wordingProblems(post));
  problems.push(...inventedPrices(post, catalog));
  // Primary keyword in title/H1, slug, meta description and first sentence.
  problems.push(
    ...keywordProblems(
      {
        title: post.title?.en ?? "",
        slug: post.slug,
        seoDescription: post.seo?.en?.meta_description ?? "",
        intro: post.intro?.en ?? "",
      },
      post.seo?.en?.focus_keyword ?? "",
    ),
  );
  problems.push(...firstHandProblems(post));
  try {
    JSON.parse(JSON.stringify(post));
  } catch {
    problems.push("post is not serialisable JSON");
  }
  if (existing.some((e) => e.post.slug === post.slug))
    problems.push(`slug ${post.slug} already exists`);
  // Duplicate-topic guard: near-identical title, or the same search intent (top places, best
  // time, itinerary, ...) for the same place as an existing post, merged posts included.
  const dupPost = findDuplicateTopic(
    { slug: post.slug, title: post.title?.en ?? "", destination: post.destination },
    existing.filter((e) => e.post.slug !== post.slug),
  );
  if (dupPost) problems.push(`duplicate topic: ${dupPost.reason}`);
  return [...new Set(problems)];
}

/* ------------------------------------------------------------ seasonal refresh */

async function seasonalRefresh(entry, catalog) {
  const { post } = entry;
  const now = new Date();
  const seasonKey = nowIso(now).slice(0, 7);
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  }).format(now);
  const dest = catalog.destinations.get(post.destination);
  const pkgs = (post.relatedPackages ?? [])
    .map((s) => catalog.packages.get(s))
    .filter(isLivePackage);
  const user = [
    "TASK: SEASONAL",
    `Article: ${post.title?.en}`,
    `Write a short, current section for ${monthLabel}: what travellers can expect if they go now and over the next 6-8 weeks.`,
    "Cover typical weather and temperatures for these weeks, daylight, what is open or closed seasonally (mountain passes, lifts, lakes, festivals), crowds, and what to pack.",
    "Only general seasonal facts, no specific event dates or prices.",
    destinationFacts(dest),
    "Our tours in this article:",
    pkgs.map(packageFacts).join("\n"),
    "",
    "Write PLAIN TEXT (not JSON) in exactly this layout, one item per line:",
    `HEADING: <H2 that includes ${monthLabel}>`,
    "PARAGRAPH: <4-5 sentences, 70-100 words>",
    "PARAGRAPH: <4-5 sentences, 70-100 words>",
    "HIGHLIGHT: <8-16 words>",
    "HIGHLIGHT: <...>",
    "HIGHLIGHT: <...>",
  ].join("\n");
  const res = await chat({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: STYLE_RULES },
      { role: "user", content: user },
    ],
    max_tokens: 900,
    temperature: 0.5,
    mock: mockReply,
  });
  const body = parseSectionText(res.text);
  const paragraphs = Array.isArray(body?.paragraphs)
    ? body.paragraphs.filter((p) => typeof p === "string" && p.trim())
    : [];
  if (!body?.heading || paragraphs.length < 2)
    return { reasons: ["seasonal section invalid"] };
  const highlights = (Array.isArray(body.highlights) ? body.highlights : [])
    .filter((h) => typeof h === "string")
    .slice(0, 4);
  const strings = { heading: body.heading, place: monthLabel };
  paragraphs.forEach((p, j) => (strings[`p${j}`] = p));
  highlights.forEach((h, j) => (strings[`h${j}`] = h));
  const { out: tr, failures, dropped } = await translateStrings(
    strings,
    "seasonal update section of a travel blog article",
  );
  const seasonParas = paragraphLists(
    paragraphs.map((_, j) => `p${j}`),
    tr,
    dropped,
    failures,
    "seasonal paragraphs",
  );
  if (failures.length)
    return {
      reasons: [`translation failed: ${failures.slice(0, 3).join("; ")}`],
    };
  const loc = (k) =>
    Object.fromEntries(LOCALES.map((l) => [l, tr[l][k] ?? ""]));
  const locList = (keys) =>
    Object.fromEntries(
      LOCALES.map((l) => [l, keys.map((k) => tr[l][k] ?? "")]),
    );
  const section = {
    id: "this-season",
    seasonKey,
    placeName: loc("place"),
    heading: loc("heading"),
    paragraphs: seasonParas,
    highlights: locList(highlights.map((_, j) => `h${j}`)),
    keyFacts: [],
  };
  const next = structuredClone(post);
  const at = next.sections.findIndex((s) => s.id === "this-season");
  if (at >= 0) next.sections[at] = section;
  else next.sections.push(section);
  const problems = [
    ...wordingProblems(next),
    ...inventedPrices({ sections: [section] }, catalog),
  ];
  if (problems.length) return { reasons: problems };
  return { post: next, reasons: [] };
}

/* ------------------------------------------------------------ main */

async function main() {
  const catalog = loadCatalog();
  const queue = readJson(QUEUE_FILE);
  const existing = loadPosts();
  const report = {
    startedAt: nowIso(),
    backend: backend(),
    dryRun: DRY,
    created: [],
    skipped: [],
    refreshed: [],
    refreshSkipped: [],
  };
  report.models = describeModels();
  report.preview = PREVIEW;
  const budget = dailyBudget(existing);
  report.dailyBudget = budget;
  report.publication = { state: "generated-only", deployed: false, liveVerified: false };
  if (WRITE && budget.remaining === 0) {
    report.stopped = "daily generation cap reached";
    report.usage = { calls: 0, promptTokens: 0, completionTokens: 0, neurons: 0, nvidia: ledger.nvidia };
    report.queuePending = queue.topics.filter(t => t.status === "pending").length;
    report.finishedAt = nowIso();
    if (args.report) writeFileSync(String(args.report), JSON.stringify(report, null, 2) + "\n");
    console.log(`[blog:daily] generation cap reached (${budget.generated}/${budget.limit} for ${budget.date} Asia/Dubai); no writing or refresh`);
    return;
  }
  console.log(
    `[blog:daily] backend=${report.backend} text=${report.models.text} translate=${report.models.translate} count=${COUNT} refresh=${REFRESH}${DRY ? " (dry run)" : ""}`,
  );
  if (report.backend === "none") {
    console.error(
      "❌ No AI credentials. Set NVIDIA_API_KEY (preferred); TRANSLATE_SECRET or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_API_TOKEN are the Workers AI last-resort fallback.",
    );
    process.exit(2);
  }

  // 0. Image registry: refresh uses from content (hashes only images it has not seen).
  REGISTRY = loadRegistry();
  try {
    await seedRegistry({ reg: REGISTRY, log: (m) => console.log(m) });
  } catch (err) {
    console.log(`[images] registry refresh failed (${err.message || err}); using the committed registry.`);
  }
  const imgStatus = imageFinderStatus();
  report.images = imgStatus;
  console.log(
    `[images] finder ${IMAGE_FINDER && imgStatus.enabled ? "on" : "off"}: sources=${imgStatus.sources.join(",")} upload=${imgStatus.upload}${imgStatus.missing ? ` (missing secret: ${imgStatus.missing})` : ""}`,
  );

  // 1. New posts
  let stopReason = "";
  const useRotation = !args.topic && !args["no-rotation"];
  const rotation = useRotation ? loadRotation() : null;
  const slotNow = rotation ? pickSlot(rotation, new Date(), COUNT) : currentSlot();
  const slotArg = String(args.slot ?? "auto");
  const runSlot = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? "")) ? String(args.date) : slotNow.date,
    slot: /^[0-2]$/.test(slotArg) ? Number(slotArg) : slotNow.slot,
  };
  const keywordStore = loadKeywordStore();
  const USE_BANK = !args["no-bank"];
  report.keywordBank = { enabled: USE_BANK, runs: [], remainingBefore: bankRemaining(keywordStore) };
  const research = USE_BANK
    ? async (slug) => {
        const r = bankTopics(keywordStore, slug, { catalog, posts: existing, count: COUNT });
        console.log(`[keywords] ${slug}: ${r.stats.unused} unused bank keyword(s)${r.stats.covered.length ? `, ${r.stats.covered.length} already covered by posts` : ""}`);
        for (const x of r.stats.covered.slice(0, 5)) console.log(`[keywords]   covered "${x.keyword}": ${x.reason}`);
        if (r.stats.unused < COUNT * 3)
          console.log(`::warning::Keyword bank for ${slug} is low (${r.stats.unused} unused). Re-run: node scripts/build-keyword-bank.mjs --only=${slug}`);
        report.keywordBank.runs.push({ destination: slug, unused: r.stats.unused, covered: r.stats.covered.length, topics: r.topics.map((t) => t.keyword) });
        return r;
      }
    : null;

  let dayPlan = null;
  let want = COUNT;
  const destFailures = [];
  report.destinationFails = destFailures;

  /** Try every topic in `pending` until `wantThis` posts are created, attempts/budget/fatal stop. */
  async function writeTopics(pending, wantThis) {
    let attempts = 0;
    const createdBefore = report.created.length;
    for (let topic of pending) {
      if (WRITE && report.created.length >= budget.remaining) break;
      if (report.created.length - createdBefore >= wantThis || attempts >= MAX_ATTEMPTS) break;
      if (topic.planned) {
        topic = DRY ? { ...topic.planned } : materializeTopic(queue, topic.planned);
      }
      // Never re-generate a queue topic already marked skipped / exhausted.
      if (topic.status === "skipped" || (topic.attempts ?? 0) >= 2) {
        console.log(`\n→ ${topic.keyword || topic.id}: already skipped (${topic.attempts ?? 0} attempts); not retrying`);
        report.skipped.push({ topic: topic.id, reasons: [`already skipped (${topic.attempts ?? 0} attempts)`] });
        continue;
      }
      if (report.created.length - createdBefore >= wantThis || attempts >= MAX_ATTEMPTS) break;
      if (overBudget()) {
        report.budgetStop = `time budget of ${MAX_MINUTES} min reached before topic ${topic.id}`;
        console.log(`  ■ ${report.budgetStop}`);
        break;
      }
      attempts += 1;
      const slug = slugify(topic.keyword || topic.slug || topic.id);
      console.log(`\n→ ${topic.keyword} (${slug})`);
      const dup = findDuplicateTopic(
        { slug, title: topic.keyword, destination: topic.destination },
        existing,
      );
      if (dup) {
        Object.assign(topic, {
          status: "skipped",
          reason: `duplicate of ${dup.post.slug}: ${dup.reason}`,
          checkedAt: nowIso(),
        });
        report.skipped.push({
          topic: topic.id,
          reasons: [`duplicate of ${dup.post.slug}: ${dup.reason}`],
        });
        console.log(`  ✗ duplicate of ${dup.post.slug}: ${dup.reason}`);
        continue;
      }
      let result;
      try {
        result = await generatePost(topic, catalog, existing);
      } catch (err) {
        if (err?.fatal) {
          stopReason = err.quota ? "quota" : "fatal";
          report.stopped = `${stopReason}: ${err.message || err}`;
          console.log(`  ■ stopping: ${report.stopped} (topic stays pending)`);
          break;
        }
        result = { reasons: [`error: ${err.message || err}`] };
      }
      if (result.reasons.length || !result.post) {
        await PENDING_IMAGES.catch(() => null);
        clearUses(REGISTRY, "blog", slug); // uploads stay reserved for a retry
        topic.attempts = (topic.attempts ?? 0) + 1;
        topic.lastError = result.reasons.slice(0, 4).join(" | ");
        topic.checkedAt = nowIso();
        if (topic.attempts >= 2) topic.status = "skipped";
        report.skipped.push({ topic: topic.id, reasons: result.reasons });
        console.log(
          `  ✗ failed gates:\n    - ${result.reasons.slice(0, 8).join("\n    - ")}`,
        );
        continue;
      }
      const post = result.post;
      if (WRITE) {
        writeJson(join(BLOG_DIR, `${post.slug}.json`), post);
        if (topic.source === "keyword-bank") markBankUsed(keywordStore, topic.destination, topic.keyword, post.slug, post.publishedAt);
      } else if (PREVIEW) {
        mkdirSync("blog-preview", { recursive: true });
        writeJson(join("blog-preview", `${post.slug}.json`), post);
      }
      keywordStore.posts[post.slug] = {
        primary: post.seo.en.focus_keyword,
        secondary: topic.secondary ?? [],
        questions: topic.questions ?? [],
        destination: post.destination,
        date: runSlot.date,
        slot: dayPlan ? runSlot.slot : null,
        source: topic.source === "keyword-bank" ? "keyword-bank" : "queue/template",
        ...(topic.research ? { score: topic.research.score, intent: topic.research.intent, sources: topic.research.sources } : {}),
        createdAt: post.publishedAt,
      };
      existing.push({ file: join(BLOG_DIR, `${post.slug}.json`), post });
      Object.assign(topic, {
        status: "published",
        slug: post.slug,
        publishedAt: post.publishedAt,
      });
      delete topic.lastError;
      report.created.push({
        topic: topic.id,
        destination: topic.destination,
        slug: post.slug,
        title: post.title.en,
        keyword: post.seo.en.focus_keyword,
        secondary: topic.secondary ?? [],
        questions: topic.questions ?? [],
        metaDescription: post.seo.en.meta_description,
        firstSentence: (post.intro.en.match(/^[\s\S]*?[.?!](?=\s|$)/) ?? [post.intro.en])[0],
        words: englishWordCount(post),
        urls: LOCALES.map((l) => `${SITE_ORIGIN}/${l}/blog/${post.slug}/`),
      });
      console.log(
        `  ✓ ${post.title.en} — ${englishWordCount(post)} words, ${post.sections.length} sections, 5 locales`,
      );
    }
    return report.created.length - createdBefore;
  }

  if (!useRotation) {
    const pending = queue.topics.filter(
      (t) => t.status === "pending" && (!args.topic || t.id === args.topic),
    );
    want = COUNT;
    await writeTopics(pending, want);
  } else {
    // Destination failover: after a destination yields 0 posts, block it for this UTC date and
    // immediately plan the next destination in the SAME process (cap MAX_DEST_TRIES).
    for (let destTry = 0; destTry < MAX_DEST_TRIES; destTry += 1) {
      dayPlan = await planRun(catalog, queue, existing, rotation, {
        count: COUNT,
        date: runSlot.date,
        slot: runSlot.slot,
        research,
      });
      report.rotation = {
        date: runSlot.date,
        slot: runSlot.slot,
        destination: dayPlan.destination,
        done: Boolean(dayPlan.done),
        sameSlot: Boolean(dayPlan.sameSlot),
        newPass: dayPlan.reset,
        skippedDestinations: [...(dayPlan.skipped ?? []), ...destFailures],
        planned: dayPlan.topics.map((t) => t.keyword),
        destinationTry: destTry + 1,
      };
      for (const s of dayPlan.skipped ?? []) console.log(`[rotation] skip ${s.destination}: ${s.reason}`);
      const label = `${runSlot.date} slot ${runSlot.slot}`;
      if (dayPlan.done) {
        console.log(`[rotation] ${label} already has ${COUNT} posts (${dayPlan.destination}); nothing to write.`);
        want = 0;
        break;
      }
      if (!dayPlan.destination) {
        console.log("[rotation] no destination can yield enough non-duplicate topics for this run");
        want = COUNT;
        break;
      }
      console.log(
        `[rotation] ${label}: ${dayPlan.name} (/destinations/${dayPlan.destination}/)${dayPlan.sameSlot ? ` top-up (${dayPlan.already} already)` : ""}${destTry ? ` [failover try ${destTry + 1}/${MAX_DEST_TRIES}]` : ""} — ${dayPlan.topics.slice(0, COUNT).map((t) => t.keyword).join(" | ")}${dayPlan.topics.length > COUNT ? ` (+${dayPlan.topics.length - COUNT} reserve)` : ""}`,
      );
      for (const t of dayPlan.topics.slice(0, COUNT + 2))
        if (t.secondary || t.questions)
          console.log(`[keywords] ${t.keyword}  (score ${t.research?.score ?? "-"})\n    secondary: ${(t.secondary ?? []).join(" | ")}\n    questions: ${(t.questions ?? []).join(" | ")}`);

      want = dayPlan.sameSlot ? Math.max(0, COUNT - (dayPlan.already ?? 0)) : COUNT;
      if (want === 0) break;
      const createdThis = await writeTopics(
        dayPlan.topics.map((t) => ({ planned: t })),
        want,
      );
      if (stopReason || overBudget()) break;
      if (createdThis > 0) {
        // Full or partial success: recordDay + same-slot top-up handle the rest next run.
        break;
      }
      // 0 posts from this destination: block for the date and try the next one now.
      const why =
        report.skipped
          .filter((s) => dayPlan.topics.some((t) => t.id === s.topic))
          .map((s) => `${s.topic}: ${(s.reasons ?? [])[0] ?? "failed"}`)
          .slice(0, 3)
          .join("; ") || "all topics failed or none left";
      console.log(
        `[rotation] ${dayPlan.destination} yielded 0 posts (${why}); blocking for ${runSlot.date} and trying next destination`,
      );
      recordBlocked(rotation, runSlot.date, dayPlan.destination, why);
      destFailures.push({ destination: dayPlan.destination, reason: why });
    }
  }

  // 2. Seasonal refresh of the oldest posts
  const seasonKey = nowIso().slice(0, 7);
  const minAgeMs = MIN_AGE_DAYS * 86400 * 1000;
  const createdSlugs = new Set(report.created.map((c) => c.slug));
  const candidates = existing
    .filter((e) => !createdSlugs.has(e.post.slug) && e.post.published !== false)
    .filter(
      (e) =>
        !(e.post.sections ?? []).some(
          (s) => s.id === "this-season" && s.seasonKey === seasonKey,
        ),
    )
    .filter(
      (e) =>
        Date.now() - dateValue(e.post.updatedAt || e.post.publishedAt) >=
        minAgeMs,
    )
    .sort(
      (a, b) =>
        dateValue(a.post.updatedAt || a.post.publishedAt) -
        dateValue(b.post.updatedAt || b.post.publishedAt),
    );
  for (const entry of stopReason ? [] : candidates.slice(0, REFRESH)) {
    if (overBudget()) {
      report.budgetStop ??= `time budget of ${MAX_MINUTES} min reached before seasonal refresh`;
      break;
    }
    console.log(
      `\n↻ seasonal refresh: ${entry.post.slug} (last updated ${entry.post.updatedAt})`,
    );
    let res;
    try {
      res = await seasonalRefresh(entry, catalog);
    } catch (err) {
      if (err?.fatal) {
        stopReason = err.quota ? "quota" : "fatal";
        report.stopped = `${stopReason}: ${err.message || err}`;
        console.log(`  ■ stopping: ${report.stopped}`);
        break;
      }
      res = { reasons: [`error: ${err.message || err}`] };
    }
    if (!res.post) {
      report.refreshSkipped.push({
        slug: entry.post.slug,
        reasons: res.reasons,
      });
      console.log(`  ✗ ${res.reasons.join("; ")}`);
      continue;
    }
    const moved = finalizeDates(entry.post, res.post, {
      reason: `seasonal section ${seasonKey}`,
    });
    if (moved) {
      if (WRITE) writeJson(entry.file, res.post);
      report.refreshed.push(entry.post.slug);
      console.log(`  ✓ added "${res.post.sections.at(-1).heading.en}"`);
    }
  }
  if (candidates.length === 0)
    console.log(
      `\n(no post is older than ${MIN_AGE_DAYS} days without a ${seasonKey} section; no seasonal refresh needed)`,
    );

  if (WRITE) {
    await PENDING_IMAGES.catch(() => null);
    saveRegistry(REGISTRY);
    writeJson(QUEUE_FILE, queue);
    if (report.created.length) saveKeywordStore(keywordStore);
    // Advance the rotation unless the AI quota stopped the day before any post was written
    // (then tomorrow retries the same destination). Always persist blockedDestinations so a
    // 0-post destination (e.g. Turkmenistan inventing prices) is not sticky-retried hourly.
    if (rotation) {
      if (dayPlan?.destination && !dayPlan.done && report.created.length > 0) {
        const createdIds = report.created.map((c) => c.topic).filter(Boolean);
        saveRotation(recordDay(rotation, dayPlan, createdIds));
      } else if (destFailures.length || rotation.blockedDestinations) {
        saveRotation(rotation);
      }
    }
    recordChanged([...report.created.map((c) => c.slug), ...report.refreshed]);
  }
  report.usage = {
    calls: ledger.calls,
    promptTokens: ledger.promptTokens,
    completionTokens: ledger.completionTokens,
    neurons: Math.round(ledger.neurons),
    nvidia: ledger.nvidia,
    byModel: Object.fromEntries(
      Object.entries(ledger.byModel).map(([k, v]) => [
        k,
        { ...v, neurons: Math.round(v.neurons) },
      ]),
    ),
  };
  report.queuePending = queue.topics.filter(
    (t) => t.status === "pending",
  ).length;
  report.finishedAt = nowIso();
  console.log(
    `\n[blog:daily] created ${report.created.length}, skipped ${report.skipped.length}, refreshed ${report.refreshed.length}; ~${report.usage.neurons} neurons in ${ledger.calls} calls; ${report.queuePending} topics left.`,
  );
  if (args.report)
    writeFileSync(String(args.report), JSON.stringify(report, null, 2) + "\n");
  if (stopReason === "quota") process.exitCode = 4;
  else if (stopReason) process.exitCode = 1;
  // A run that was meant to write posts and wrote none fails (exit 3); the workflow commits the
  // queue/rotation state first, then marks the run failed so it is visible (2-3 Nov: 3 silent 0-post runs).
  else if (!DRY && report.created.length === 0 && want > 0 && !dayPlan?.done) {
    console.log(`::error::No new post was generated (wanted ${want}). Skipped: ${report.skipped.map((x) => `${x.topic} (${x.reasons[0]})`).join("; ") || "none planned"}`);
    process.exitCode = 3;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly)
  main().catch((err) => {
    console.error("❌ [blog:daily]", err.stack || err);
    process.exit(1);
  });
