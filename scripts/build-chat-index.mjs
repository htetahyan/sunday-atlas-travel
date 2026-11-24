/**
 * Build public/chat-index/{locale}.json for the Pages chat function.
 * No extra dependencies. Run from anywhere; paths are relative to the repo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "de", "fr", "ja", "es"];
const SUMMARY_MAX = 400;

/**
 * Han, Hiragana, Katakana, Hangul, plus the long-vowel mark ー (U+30FC) and
 * its halfwidth form. Unicode classifies ー as Common, so a script-only class
 * would split ブータン into ブ and タン and drop the ブー / ータ bigrams.
 */
const CJK_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30fc\uff70]+/gu;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonDir(folder) {
  const dir = path.join(root, "content", folder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readJson(path.join(dir, file)));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Same rule as src/lib/content.ts pick(): non-empty locale value, else English. */
function pick(value, locale) {
  if (Array.isArray(value) || typeof value === "string" || value == null) return value;
  if (!isRecord(value) || !("en" in value)) return value;
  if (locale !== "en") {
    const chosen = value[locale];
    if (typeof chosen === "string" && chosen.length > 0) return chosen;
    if (Array.isArray(chosen) && chosen.length > 0) return chosen;
  }
  return value.en;
}

/** Same rule as src/i18n/getDictionary.ts deepMerge(). */
function deepMerge(base, override) {
  if (Array.isArray(base)) {
    if (override === undefined || override === "") return base;
    return override;
  }
  if (!isRecord(base)) {
    if (override === undefined || override === "") return base;
    return override;
  }
  const extra = isRecord(override) ? override : {};
  const out = {};
  for (const key of Object.keys(base)) {
    const next = extra[key];
    if (next === undefined || next === "") out[key] = base[key];
    else if (isRecord(base[key]) && isRecord(next)) out[key] = deepMerge(base[key], next);
    else out[key] = next;
  }
  return out;
}

function scriptOf(char) {
  if (char === "ー" || char === "ｰ") return "Kana";
  if (/\p{Script=Hiragana}/u.test(char)) return "Hira";
  if (/\p{Script=Katakana}/u.test(char)) return "Kana";
  if (/\p{Script=Han}/u.test(char)) return "Han";
  if (/\p{Script=Hangul}/u.test(char)) return "Hang";
  return "Other";
}

/** Hiragana particles would otherwise glue the next word onto the previous one. */
function splitScripts(run) {
  const parts = [];
  let current = "";
  let script = "";
  for (const char of Array.from(run)) {
    let next = scriptOf(char);
    if ((char === "ー" || char === "ｰ") && script) next = script;
    if (current && next !== script) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
    script = next;
  }
  if (current) parts.push(current);
  return parts;
}

/** CJK words, split by script. A number written against the first word is kept (3スタン). */
function cjkPieces(text) {
  const pieces = [];
  CJK_RUN.lastIndex = 0;
  for (const match of text.matchAll(CJK_RUN)) {
    const segments = splitScripts(match[0]);
    const start = match.index ?? 0;
    let digits = "";
    for (let i = start - 1; i >= 0 && /\d/u.test(text[i] ?? ""); i -= 1) digits = (text[i] ?? "") + digits;
    if (digits && segments[0]) pieces.push(digits + segments[0]);
    pieces.push(...segments);
  }
  return pieces;
}

function tokenize(text) {
  const lower = String(text ?? "").toLowerCase();
  const parts = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = new Set(parts);
  for (const run of cjkPieces(lower)) {
    out.add(run);
    const chars = Array.from(run);
    for (let i = 0; i < chars.length - 1; i += 1) {
      out.add(chars[i] + chars[i + 1]);
    }
  }
  return [...out];
}

function keywordsFrom(...parts) {
  const tokens = new Set();
  for (const part of parts) {
    if (part == null) continue;
    const text = Array.isArray(part) ? part.join(" ") : String(part);
    for (const token of tokenize(text)) tokens.add(token);
  }
  return [...tokens].sort();
}

function summarize(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= SUMMARY_MAX) return clean;
  const cut = clean.slice(0, SUMMARY_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > SUMMARY_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Phrases the package page uses for the table printed under the price.
 * The index points at the tour page instead. Keep the wording in sync with
 * `seePriceTable` in functions/api/_i18n.ts.
 */
const TABLE_BELOW_PHRASES = [
  "see the table below",
  "siehe Tabelle unten",
  "voir le tableau ci-dessous",
  "下の料金表をご覧ください",
  "vea la tabla de abajo",
];

const SEE_PRICE_TABLE = {
  en: "see the price table on the tour page: {url}",
  de: "siehe die Preistabelle auf der Reiseseite: {url}",
  fr: "voir la grille tarifaire sur la page du circuit : {url}",
  ja: "ツアーページの料金表をご覧ください：{url}",
  es: "vea la tabla de precios en la página del tour: {url}",
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function seePriceTable(locale, url) {
  const text = SEE_PRICE_TABLE[locale].replaceAll("{url}", url);
  if (/[.。]$/u.test(text)) return text;
  return `${text}${locale === "ja" ? "。" : "."}`;
}

/** Replace a trailing "see the table below" (any locale) and tidy `; ` or `、` around it. */
function rewordSeeTable(note, locale, url) {
  const body = TABLE_BELOW_PHRASES.map(escapeRegExp).join("|");
  const re = new RegExp(String.raw`(\s*[;；]\s*|\s*、\s*)?(?:${body})\s*[.。]?`, "giu");
  const replacement = seePriceTable(locale, url);
  return note.replace(re, (_full, sep) => {
    if (sep && /[;；、]/.test(sep)) {
      const mark = sep.includes("、") ? "、" : sep.includes("；") ? "；" : ";";
      const lead = /^\s/u.test(sep) ? " " : "";
      return `${lead}${mark} ${replacement}`;
    }
    return replacement;
  });
}

/**
 * Unpriced packages only. A note that already contains a digit is dropped so the
 * index does not keep a stray amount. Listed prices bypass this and are stored whole.
 */
function onRequestText(note, fallback) {
  const text = clean(note);
  if (!text || /\d/.test(text)) return fallback;
  return text;
}

/** True when this locale should omit the entry: unpublished, draft, or noindex. */
function indexed(entry, locale) {
  if (entry.published !== true || entry.draft === true) return false;
  const seo = entry.seo;
  if (!isRecord(seo)) return true;
  const block = seo[locale];
  return !(isRecord(block) && block.noindex === true);
}

function copyPrices(value) {
  if (!Array.isArray(value)) return [];
  if (!value.every((item) => typeof item === "number" && Number.isFinite(item))) return [];
  return value.slice();
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

/** Localized price grid, numbers copied as stored. */
function priceTable(table, locale) {
  if (!isRecord(table)) return { caption: "", groupSizes: [], rows: [], note: "" };
  const rows = Array.isArray(table.rows)
    ? table.rows.flatMap((row) => {
        if (!isRecord(row)) return [];
        const label = clean(pick(row.label, locale));
        const prices = copyPrices(row.prices);
        const singleSupplement = typeof row.singleSupplement === "string" ? row.singleSupplement : "";
        if (!label && prices.length === 0 && !singleSupplement) return [];
        return [{ label, prices, singleSupplement }];
      })
    : [];
  return {
    caption: clean(pick(table.caption, locale)),
    groupSizes: stringList(pick(table.groupSizes, locale)),
    rows,
    note: clean(pick(table.note, locale)),
  };
}

/**
 * A listed price is a numeric priceFrom plus a currency. The object is what the
 * package page shows. Packages without that pair stay on request and have no price object.
 */
function packagePrice(entry, locale, priceFallback) {
  const from = entry.priceFrom;
  const currency = typeof entry.currency === "string" ? entry.currency.trim() : "";
  if (typeof from !== "number" || !Number.isFinite(from) || !currency) {
    return { priceText: onRequestText(pick(entry.priceNote, locale), priceFallback), price: null };
  }
  const fromLabel = clean(pick(entry.fromLabel, locale));
  const url = `/${locale}/packages/${entry.slug}/`;
  const note = rewordSeeTable(clean(pick(entry.priceNote, locale)), locale, url);
  const table = priceTable(entry.priceTable, locale);
  return {
    priceText: (locale === "ja" ? `${fromLabel}。${note}` : `${fromLabel}. ${note}`).trim(),
    price: { from, currency, fromLabel, note, table },
  };
}

function loadDictionary(locale) {
  const en = readJson(path.join(root, "src/i18n/dictionaries/en.json"));
  if (locale === "en") return en;
  const local = readJson(path.join(root, "src/i18n/dictionaries", `${locale}.json`));
  return deepMerge(en, local);
}

function destinationEntries(destinations, locale) {
  return destinations
    .filter((entry) => indexed(entry, locale))
    .map((entry) => {
      const name = String(pick(entry.name, locale) ?? "");
      const nameEn = String(pick(entry.name, "en") ?? "");
      const region = String(pick(entry.region, locale) ?? "");
      const regionEn = String(pick(entry.region, "en") ?? "");
      const highlights = (pick(entry.highlights, locale) ?? []).map(String);
      const seasons = (pick(entry.bestSeasons, locale) ?? []).map(String);
      const summary = summarize(pick(entry.summary, locale));
      return {
        id: `destination:${entry.slug}`,
        type: "destination",
        title: name,
        url: `/${locale}/destinations/${entry.slug}/`,
        summary,
        highlights,
        bestSeasons: seasons,
        keywords: keywordsFrom(entry.slug, name, nameEn, region, regionEn, summary, highlights, seasons),
      };
    });
}

function packageEntries(packages, destinations, locale, priceFallback, dict, dictEn) {
  const bySlug = new Map(destinations.map((entry) => [entry.slug, entry]));
  return packages
    .filter((entry) => indexed(entry, locale))
    .map((entry) => {
      const title = String(pick(entry.title, locale) ?? "");
      const titleEn = String(pick(entry.title, "en") ?? "");
      const dest = bySlug.get(entry.destination);
      const destName = dest ? String(pick(dest.name, locale) ?? entry.destination) : String(entry.destination);
      const destNameEn = dest ? String(pick(dest.name, "en") ?? entry.destination) : String(entry.destination);
      const pkgRegion = String(pick(entry.region, locale) ?? "");
      const pkgRegionEn = String(pick(entry.region, "en") ?? "");
      const destRegion = dest ? String(pick(dest.region, locale) ?? "") : "";
      const destRegionEn = dest ? String(pick(dest.region, "en") ?? "") : "";
      const region = pkgRegion || destRegion;
      const regionEn = pkgRegionEn || destRegionEn;
      const isDayTour =
        typeof entry.isDayTour === "boolean" ? entry.isDayTour : entry.durationDays === 1;
      const dayTourKeywords = isDayTour
        ? [dict?.packages?.dayTourBadge, dictEn?.packages?.dayTourBadge, "day tour"]
        : [];
      const dayTitles = (entry.itinerary ?? []).map((day) => String(pick(day.title, locale) ?? ""));
      const dayTitlesEn = (entry.itinerary ?? []).map((day) => String(pick(day.title, "en") ?? ""));
      const built = packagePrice(entry, locale, priceFallback);
      const summary = summarize(pick(entry.summary, locale));
      const priceWords = built.price
        ? [
            built.price.fromLabel,
            built.price.note,
            built.price.table.caption,
            ...built.price.table.groupSizes,
            ...built.price.table.rows.map((row) => row.label),
            built.price.table.note,
          ]
        : [];
      const record = {
        id: `package:${entry.slug}`,
        type: "package",
        title,
        url: `/${locale}/packages/${entry.slug}/`,
        summary,
        durationDays: entry.durationDays,
        destination: { slug: entry.destination, name: destName },
        highlights: dayTitles,
        priceText: built.priceText,
        keywords: keywordsFrom(
          entry.slug,
          entry.destination,
          title,
          titleEn,
          destName,
          destNameEn,
          region,
          regionEn,
          destRegion,
          destRegionEn,
          dayTourKeywords,
          summary,
          dayTitles,
          dayTitlesEn,
          built.priceText,
          priceWords,
          pick(entry.style, locale),
          pick(entry.style, "en"),
        ),
      };
      if (built.price) record.price = built.price;
      return record;
    });
}

function faqEntries(dict, dictEn, locale) {
  const items = dict.faq?.items ?? [];
  const itemsEn = dictEn.faq?.items ?? [];
  return items.map((item, index) => {
    const title = String(item.q ?? "");
    const titleEn = String(itemsEn[index]?.q ?? title);
    const summary = summarize(item.a);
    return {
      id: `faq:${index}`,
      type: "faq",
      title,
      url: `/${locale}/faq/`,
      summary,
      keywords: keywordsFrom(title, titleEn, summary, dict.faq?.title, dictEn.faq?.title),
    };
  });
}

function howEntries(dict, dictEn, locale) {
  const steps = dict.howItWorks?.steps ?? [];
  const stepsEn = dictEn.howItWorks?.steps ?? [];
  return steps.map((step, index) => {
    const title = String(step.title ?? "");
    const titleEn = String(stepsEn[index]?.title ?? title);
    const summary = summarize(step.body);
    return {
      id: `howItWorks:${index}`,
      type: "howItWorks",
      title,
      url: `/${locale}/how-it-works/`,
      summary,
      keywords: keywordsFrom(title, titleEn, summary, dict.howItWorks?.title, dictEn.howItWorks?.title),
    };
  });
}

function contactEntry(dict, dictEn, locale) {
  const title = String(dict.contact?.title ?? "");
  const titleEn = String(dictEn.contact?.title ?? title);
  const summary = summarize(dict.contact?.lede);
  return {
    id: "contact",
    type: "contact",
    title,
    url: `/${locale}/contact/`,
    summary,
    keywords: keywordsFrom(title, titleEn, summary, dict.nav?.contact, dictEn.nav?.contact, "contact"),
  };
}

function pageNoindex(page, locale) {
  const seo = page?.seo;
  if (!isRecord(seo)) return false;
  const block = seo[locale];
  return isRecord(block) && block.noindex === true;
}

function buildLocale(locale, destinations, packages, dictEn, pages) {
  const dict = loadDictionary(locale);
  const priceFallback = String(dict.packages?.priceOnRequest ?? "Price on request");
  const entries = [
    ...destinationEntries(destinations, locale),
    ...packageEntries(packages, destinations, locale, priceFallback, dict, dictEn),
  ];
  if (!pageNoindex(pages.faq, locale)) entries.push(...faqEntries(dict, dictEn, locale));
  if (!pageNoindex(pages.howItWorks, locale)) entries.push(...howEntries(dict, dictEn, locale));
  if (!pageNoindex(pages.contact, locale)) entries.push(contactEntry(dict, dictEn, locale));
  return entries;
}

const destinations = readJsonDir("destinations");
const packages = readJsonDir("packages");
const dictEn = loadDictionary("en");
const pages = {
  faq: readJson(path.join(root, "content", "pages", "faq.json")),
  howItWorks: readJson(path.join(root, "content", "pages", "how-it-works.json")),
  contact: readJson(path.join(root, "content", "pages", "contact.json")),
};
const outDir = path.join(root, "public", "chat-index");
fs.mkdirSync(outDir, { recursive: true });

for (const locale of LOCALES) {
  const entries = buildLocale(locale, destinations, packages, dictEn, pages);
  fs.writeFileSync(path.join(outDir, `${locale}.json`), `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`${locale} ${entries.length}`);
}
