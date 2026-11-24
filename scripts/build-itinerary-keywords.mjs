#!/usr/bin/env node
/**
 * Itinerary-intent keywords for the blog keyword bank (content/blog-keywords.json "bank").
 *
 *   node scripts/build-itinerary-keywords.mjs [--only=uzbekistan,poland] [--dry-run]
 *
 * Why: Search Console showed "uzbekistan itinerary 5 days" earning impressions (mostly US) at
 * position ~8, so the "[place] itinerary N days" / "N days in [place]" / "[place] and [place]
 * itinerary" / "[place] itinerary 2 weeks" family is worth a post per trip length.
 *
 * Sources (free, no keys): Google Autocomplete with US settings (hl=en, gl=us) and the titles/URLs
 * of competitor posts in public sitemaps. A phrase is kept only if it was really returned by
 * autocomplete or appears in a competitor title. No search volumes are stored or invented.
 *
 * Variants of the same search (same places + same trip-length bucket, e.g. "uzbekistan itinerary
 * 7 days" / "7 days in uzbekistan" / "uzbekistan 7 day itinerary") become ONE entry: the best one
 * is the primary keyword, the rest are its secondary keywords. Entries already covered by a post
 * or already in the bank are skipped (an unused bank entry for the same search is upgraded instead).
 * New entries carry itineraryIntent: true; scripts/lib/keyword-research.mjs bankTopics() puts one
 * of them first in every run while any remain.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPPLIER_RE, durationBucket, itineraryDays, loadCatalog, loadPosts, slugify } from "./lib/blog-core.mjs";
import { destinationPackages } from "./lib/blog-rotation.mjs";
import { SOURCES, keywordConflict, loadKeywordStore, normKw, packagesFor, placeWeights, saveKeywordStore } from "./lib/keyword-research.mjs";
import { fixYearLabels, targetYear } from "./lib/target-year.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const ONLY = args.only ? String(args.only).split(",") : null;
const DRY = Boolean(args["dry-run"]);
const YEAR = targetYear();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Main places per destination (only places our tours or destination pages actually cover).
// Multi-word places are written as they are searched.
const PLACES = {
  uzbekistan: ["tashkent", "samarkand", "bukhara", "khiva"],
  kazakhstan: ["almaty"],
  kyrgyzstan: ["bishkek", "karakol", "issyk kul"],
  tajikistan: ["dushanbe", "pamir highway"],
  turkmenistan: ["ashgabat"],
  armenia: ["yerevan"],
  azerbaijan: ["baku"],
  china: ["harbin"],
  poland: ["krakow", "zakopane", "wroclaw", "poznan"],
};
// Country pairs we really run together (multi-country tours) -> the destination that owns the post.
const COMBOS = [
  { seeds: ["uzbekistan and kyrgyzstan itinerary", "kazakhstan and kyrgyzstan itinerary", "kazakhstan kyrgyzstan uzbekistan itinerary", "uzbekistan kazakhstan kyrgyzstan itinerary", "uzbekistan and tajikistan itinerary", "uzbekistan and turkmenistan itinerary", "central asia itinerary", "central asia itinerary 2 weeks", "central asia itinerary 3 weeks", "central asia itinerary 10 days", "stans itinerary", "silk road itinerary", "silk road itinerary 2 weeks"] },
];
const COUNTRIES = ["uzbekistan", "kazakhstan", "kyrgyzstan", "tajikistan", "turkmenistan", "armenia", "azerbaijan", "china", "poland"];
const FOREIGN = /\b(georgia|tbilisi|mongolia|russia|turkey|istanbul|iran|afghanistan|pakistan|india|nepal|japan|korea|vietnam|thailand|germany|berlin|czech|prague|hungary|budapest|austria|vienna|slovakia|lithuania|latvia|estonia|ukraine|belarus|beijing|shanghai|xian|chengdu|guilin|hong kong|tibet|yunnan|zhangjiajie|seoul|dubai|europe|balkans|baltics|scandinavia|italy|uk|london|paris|warsaw and berlin)\b/;
// Words allowed besides places, numbers and the itinerary family itself (anything else drops the phrase).
const ALLOWED = new Set(("itinerary itineraries days day nights night week weeks in and for the a of to from with trip plan route road travel " +
  "first time timers perfect ultimate sample best winter summer spring autumn fall christmas budget kids family solo train car by one two three four five six seven eight nine ten " +
  "central asia silk stans stan caucasus highway city northern southern north south ski skiing hiking itinary").split(" "));

const FAMILY = /\bitinerar(y|ies)\b|\b\d{1,2} (days?|weeks?|nights?) in\b|\bin \d{1,2} (days?|weeks?)\b|\b(one|two|three|a) weeks? in\b|\b\d{1,2} day (trip|tour|plan|route)\b/;

function seedsFor(dest, places) {
  const X = dest;
  const s = [`${X} itinerary`, `${X} travel itinerary`, `${X} road trip itinerary`, `${X} itinerary 1 week`, `${X} itinerary 2 weeks`, `${X} itinerary 3 weeks`, `${X} winter itinerary`];
  for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 12, 14]) s.push(`${X} itinerary ${n} days`);
  for (const n of [3, 4, 5, 7, 10, 14]) s.push(`${n} days in ${X}`);
  for (const n of [5, 7, 10]) s.push(`${X} in ${n} days`, `${X} ${n} day itinerary`);
  s.push(`one week in ${X}`, `two weeks in ${X}`, `${X} and`);
  for (const p of places) {
    s.push(`${p} itinerary`);
    for (const n of [1, 2, 3, 4, 5]) s.push(`${p} itinerary ${n} days`);
    for (const n of [2, 3, 4]) s.push(`${n} days in ${p}`);
    s.push(`${p} and`, `${p} ${X} itinerary`);
  }
  return [...new Set(s)];
}

async function google(q) {
  for (let i = 0; i < 3; i++) {
    try { return await SOURCES.google(q); } catch (e) { await sleep(800 * (i + 1)); }
  }
  return null;
}

async function competitorTitles() {
  const cache = join(tmpdir(), "sunday-atlas-competitor-itinerary-titles.json");
  if (existsSync(cache) && Date.now() - statSync(cache).mtimeMs < 86400000) return JSON.parse(readFileSync(cache, "utf8"));
  const urls = ["https://caravanistan.com/sitemap.xml",
    ...String(process.env.KEYWORD_COMPETITOR_SITEMAPS ?? "").split(",").map((u) => u.trim()).filter(Boolean)];
  const out = new Set();
  const visit = async (url, depth = 0) => {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (keyword research; sitemap only)" }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return;
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const loc = m[1].trim();
        if (/\.xml(\?|$)/.test(loc) && depth < 1) { await visit(loc, depth + 1); continue; }
        let u; try { u = new URL(loc); } catch { continue; }
        if (/^\/(de|ru|rus|fr|fra|es|spa|it|ita|ja|jap|ger|zh|ko)(\/|$)/.test(u.pathname)) continue;
        const last = decodeURIComponent(u.pathname.replace(/\/$/, "").split("/").pop().replace(/\.html?$/, ""));
        const phrase = normKw(last.replace(/[_-]+/g, " "));
        if (FAMILY.test(phrase) && phrase.length <= 70) out.add(phrase);
      }
    } catch { /* optional */ }
  };
  for (const u of urls) await visit(u);
  writeFileSync(cache, JSON.stringify([...out]));
  return [...out];
}

/** Normalise a raw phrase and say whether it belongs to `dest`; returns null to drop it. */
function accept(k, dest, places) {
  if (!FAMILY.test(k) || /how many days/.test(k)) return null;
  if (FOREIGN.test(k) || SUPPLIER_RE.test(k) || /\b(tailor made|bespoke|curated|reddit|pdf|map|cost|price|tour package|packages?|cheap|honeymoon|cruise|hotel)\b/.test(k)) return null;
  const years = [...k.matchAll(/\b20\d{2}\b/g)].map((m) => Number(m[0]));
  if (years.some((y) => y < YEAR)) return null;
  const toks = k.split(" ");
  const countries = COUNTRIES.filter((c) => toks.includes(c));
  const hasPlace = places.some((p) => k.includes(p));
  if (!toks.includes(dest) && !hasPlace && !(dest === "kazakhstan" && /central asia|stans|silk road/.test(k))) return null;
  // Other countries only when one of our multi-country tours covers them all.
  if (countries.some((c) => c !== dest) && !countries.every((c) => ["uzbekistan", "kazakhstan", "kyrgyzstan", "tajikistan", "turkmenistan"].includes(c))) return null;
  if (dest === "china" && (!/harbin/.test(k) || /\b(summer|spring|autumn|fall)\b/.test(k))) return null; // our China tours are Harbin/Jilin in winter only
  if (/\b\d{1,2} \d{1,2} (days?|weeks?)\b/.test(k)) return null; // "2 3 weeks in ..." (autocomplete noise)
  const vocab = new Set([...ALLOWED, ...COUNTRIES, ...places.flatMap((p) => p.split(" "))]);
  if (!toks.every((t) => vocab.has(t) || /^\d{1,2}$/.test(t) || /^20\d{2}$/.test(t))) return null;
  const days = itineraryDays(k);
  if (days > 30) return null;
  // A whole country in 1-2 days is not a trip we would plan; city itineraries can be short.
  if (days && days < 3 && !places.some((p) => k.includes(p))) return null;
  if (toks.length < 2 || k.length > 70) return null;
  return { keyword: k, days, countries, places: places.filter((p) => k.includes(p)) };
}

// Same search = same places (the country name is dropped when a city is named: "samarkand uzbekistan
// itinerary" = "samarkand itinerary") + same trip-length bucket.
const intentKey = (c) => {
  const where = c.places.length ? c.places : c.countries;
  return [...new Set([...where, /central asia|stans|silk road/.test(c.keyword) ? "central-asia" : ""].filter(Boolean))].sort().join("+") + "|" + durationBucket(c.days);
};
const ROUND = new Set([3, 5, 7, 10, 14, 21]);

// "uzbekistan itinerary 5 days" reads best as a title; prefer it over "5 days in uzbekistan" when demand is equal.
const formRank = (k) => (/^\S+( \S+)? itinerary \d+ (days|weeks)$/.test(k) ? 0 : /itinerary/.test(k) ? 1 : 2);

const catalog = loadCatalog();
const posts = loadPosts();
const store = loadKeywordStore();
store.bank ??= { destinations: {} };
const comp = await competitorTitles();
console.log(`[itinerary] ${comp.length} competitor itinerary titles`);

const report = {};
const dests = Object.keys(PLACES).filter((d) => !ONLY || ONLY.includes(d));
for (const dest of dests) {
  const places = PLACES[dest];
  const pk = destinationPackages(catalog, dest);
  const seeds = seedsFor(dest, places);
  if (dest === "kazakhstan") seeds.push(...COMBOS[0].seeds);
  const found = new Map(); // keyword -> {hits:[{seed,rank}], competitor}
  let requests = 0, failures = 0;
  for (const seed of seeds) {
    requests++;
    const list = await google(seed);
    if (!list) { failures++; continue; }
    list.slice(0, 10).forEach((s, rank) => {
      const k = normKw(s);
      const e = found.get(k) ?? { hits: [], competitor: false };
      e.hits.push({ seed, rank });
      found.set(k, e);
    });
    await sleep(120);
  }
  for (const p of comp) {
    const e = found.get(p) ?? { hits: [], competitor: false };
    e.competitor = true;
    found.set(p, e);
  }
  const cands = [];
  for (const [k, e] of found) {
    const a = accept(k, dest, places);
    if (!a) continue;
    // Combos are owned by Kazakhstan (3/4-stans tours) unless the phrase names only one country.
    if (a.countries.length > 1 && dest !== "kazakhstan") continue;
    if (a.countries.length === 1 && a.countries[0] !== dest && !a.places.length) continue;
    const google = e.hits.length > 0;
    const best = google ? Math.min(...e.hits.map((h) => h.rank)) : 9;
    const seedsN = new Set(e.hits.map((h) => h.seed)).size;
    const score = Number(((google ? 3 : 0) + (e.competitor ? 1 : 0) + (10 - best) / 5 + Math.min(seedsN, 5) * 0.6 + (a.days ? 1 : 0) + (a.places.length || a.countries.includes(dest) ? 0.5 : 0)).toFixed(2));
    cands.push({ ...a, google, competitor: e.competitor, bestRank: google ? best + 1 : null, seeds: seedsN, score });
  }
  // Group variants of the same search.
  const groups = new Map();
  for (const c of cands) {
    const key = intentKey(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const list = store.bank.destinations[dest] ?? (store.bank.destinations[dest] = []);
  // Only bank entries that are themselves itinerary-family phrases can be the same search.
  const bankKeys = new Map(list.flatMap((e) => { const a = accept(normKw(e.keyword), dest, places); return a ? [[intentKey(a), e]] : []; }));
  let maxPri = Math.max(0, ...list.map((e) => e.priority ?? 0));
  const added = [], upgraded = [], skipped = [];
  // A length-free phrase ("tashkent itinerary") joins the strongest length group for the same places
  // as a secondary keyword, so we do not write a generic post that competes with the N-day ones.
  for (const [key, g] of [...groups]) {
    const [where, bucket] = key.split("|");
    if (bucket) continue;
    const sib = [...groups.entries()].filter(([k]) => k.startsWith(`${where}|`) && k !== key)
      .sort((a, b) => Math.max(...b[1].map((c) => c.score)) - Math.max(...a[1].map((c) => c.score)))[0];
    if (sib) { sib[1].push(...g.map((c) => ({ ...c, score: Math.min(c.score, 0) }))); groups.delete(key); }
  }
  const groupsSorted = [...groups.entries()].map(([key, g]) => {
    const pref = (c) => c.score + (ROUND.has(c.days) ? 0.8 : 0);
    g.sort((a, b) => pref(b) - pref(a) || formRank(a.keyword) - formRank(b.keyword) || a.keyword.length - b.keyword.length);
    // Title-friendly primary: the best "X itinerary N days" form if it is within 1 point of the top.
    const nice = g.find((c) => formRank(c.keyword) === 0 && pref(c) >= pref(g[0]) - 1);
    const primary = nice ?? g[0];
    return { key, primary, rest: g.filter((c) => c !== primary), score: Math.max(...g.map((c) => c.score)) + g.length * 0.3 };
  }).sort((a, b) => b.score - a.score);
  for (const { key, primary, rest } of groupsSorted) {
    const secondary = rest.map((c) => c.keyword).slice(0, 5);
    const old = bankKeys.get(key);
    if (old) {
      if (old.status === "unused" && !old.itineraryIntent) {
        old.itineraryIntent = true;
        old.itineraryDays = itineraryDays(old.keyword) || primary.days || undefined;
        old.secondary = [...new Set([...(old.secondary ?? []), primary.keyword, ...secondary].filter((k) => normKw(k) !== normKw(old.keyword)))].slice(0, 6);
        upgraded.push(old.keyword);
      } else skipped.push(`${primary.keyword} (bank: ${old.keyword}, ${old.status})`);
      continue;
    }
    const why = keywordConflict(primary.keyword, dest, posts, store);
    if (why) { skipped.push(`${primary.keyword} (${why})`); continue; }
    const pkgs = packagesFor(primary.keyword, pk);
    if (pkgs.length < 2) { skipped.push(`${primary.keyword} (fewer than 2 tours)`); continue; }
    const entry = {
      keyword: fixYearLabels(primary.keyword).text,
      destination: dest,
      priority: ++maxPri,
      kind: "itinerary",
      intent: "planning",
      itineraryIntent: true,
      ...(primary.days ? { itineraryDays: primary.days } : {}),
      score: primary.score,
      evidence: {
        sources: [primary.google && "google-autocomplete-us", primary.competitor && "competitor-titles"].filter(Boolean),
        bestAutocompleteRank: primary.bestRank,
        seedsSurfacing: primary.seeds,
        variants: rest.length,
      },
      secondary,
      questions: [`how many days in ${primary.places[0] ?? dest}`],
      packages: pkgs,
      links: { destination: `/en/destinations/${dest}/`, packages: pkgs.map((s) => `/en/packages/${s}/`) },
      category: "destination-guide",
      angle: `A real day-by-day ${primary.days ? `${primary.days}-day ` : ""}plan that answers "${primary.keyword}": where you sleep each night, drive and train times, and which of our tours runs this route`,
      status: "unused",
      addedAt: new Date().toISOString(),
      addedBy: "build-itinerary-keywords",
    };
    list.push(entry);
    bankKeys.set(key, entry);
    added.push(entry);
  }
  report[dest] = { seeds: seeds.length, requests, failures, candidates: cands.length, added: added.map((e) => e.keyword), upgraded, skipped };
  console.log(`[itinerary] ${dest}: ${requests} requests (${failures} failed), ${cands.length} candidates, +${added.length} new, ${upgraded.length} upgraded`);
  for (const e of added) console.log(`    + ${e.keyword}  [${e.evidence.sources.join("+")}, rank ${e.evidence.bestAutocompleteRank ?? "-"}, ${e.evidence.variants} variants]${e.secondary.length ? `  ~ ${e.secondary.join(" | ")}` : ""}`);
  for (const k of upgraded) console.log(`    ^ ${k}`);
  for (const k of skipped) console.log(`    - ${k}`);
}
store.bank.itineraryResearch = { generatedAt: new Date().toISOString(), method: "Google Autocomplete (hl=en, gl=us) seeded with [place] itinerary N days / N days in [place] / [place] and / 2 weeks variants, plus competitor sitemap titles; variants of one search grouped; no volumes." };
if (!DRY) saveKeywordStore(store);
writeFileSync(join(tmpdir(), "itinerary-keywords-report.json"), JSON.stringify(report, null, 2));
console.log(DRY ? "[itinerary] dry run, bank not written" : "[itinerary] bank updated -> content/blog-keywords.json");
