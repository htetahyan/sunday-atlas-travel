#!/usr/bin/env node
/**
 * Build the blog keyword bank ONCE (re-run by hand when it runs low): content/blog-keywords.json "bank".
 *
 *   node scripts/build-keyword-bank.mjs [--per=36] [--only=poland,china] [--no-competitors] [--keep-used]
 *
 * Sources (all free, no keys, public endpoints only):
 *   - Google Autocomplete (suggestqueries.google.com) and Bing Autosuggest (api.bing.com/osjson.aspx),
 *     seeded with each destination, its main cities/places and planning modifiers.
 *   - Competitor post titles: public sitemap.xml files of other Central Asia travel sites (plus any in
 *     KEYWORD_COMPETITOR_SITEMAPS). Used only as extra seeds and a "proven topic" signal; no names stored.
 * Not used: People Also Ask / related searches (needs SERP scraping, against Google's terms) and
 * Search Console (no credential configured). No search volumes exist in any of these sources, so the
 * bank ranks by a demand proxy (autocomplete position, both engines, how many seeds surfaced it) plus
 * intent, long-tail specificity and overlap with our tours. No volume numbers are stored or invented.
 *
 * Each entry: keyword, destination, priority, secondary keywords, questions (H2/FAQ), package and
 * destination links, status ("unused" | "used" + slug). Keywords already covered by an existing post
 * are left out. The generator (scripts/blog-daily.mjs) takes the next unused entries for its run.
 */
import { fixYearLabels } from "./lib/target-year.mjs";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadPosts } from "./lib/blog-core.mjs";
import { destinationPackages } from "./lib/blog-rotation.mjs";
import {
  loadKeywordStore,
  normKw,
  placeWeights,
  researchTopics,
  saveKeywordStore,
} from "./lib/keyword-research.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const PER = Number(args.per ?? 36);
// Destinations whose tours cover one region only (China = Harbin/Jilin winter): every keyword must
// name one of their places, so a post never promises a country-wide trip we do not run.
const REGIONAL = new Set(["china"]);
const ONLY = args.only ? String(args.only).split(",") : null;

// Public sitemaps of other Central Asia travel sites (titles only). More can be added at run time
// with KEYWORD_COMPETITOR_SITEMAPS (comma-separated URLs), which keeps third-party names out of the repo.
const COMPETITOR_SITEMAPS = [
  "https://caravanistan.com/sitemap.xml",
  ...String(process.env.KEYWORD_COMPETITOR_SITEMAPS ?? "").split(",").map((u) => u.trim()).filter(Boolean),
];

async function competitorPhrases() {
  if (args["no-competitors"]) return [];
  // Cache for a day: the sitemaps are large and change slowly.
  const cache = join(tmpdir(), "sunday-atlas-competitor-phrases.json");
  if (existsSync(cache) && Date.now() - statSync(cache).mtimeMs < 86400000) return JSON.parse(readFileSync(cache, "utf8"));
  const out = new Set();
  for (const url of COMPETITOR_SITEMAPS) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (keyword research; sitemap only)" }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        let u;
        try { u = new URL(m[1]); } catch { continue; }
        // English pages only.
        if (/^\/(de|ru|rus|fr|fra|es|spa|it|ita|ja|jap|ger|zh|ko)(\/|$)/.test(u.pathname)) continue;
        const last = u.pathname.replace(/\/$/, "").split("/").pop().replace(/\.html?$/, "");
        const phrase = normKw(last.replace(/[_-]+/g, " ").replace(/\b\d+\b/g, " "));
        if (phrase.split(" ").length >= 2 && phrase.length <= 70) out.add(phrase);
      }
    } catch {
      /* a competitor sitemap is optional */
    }
  }
  writeFileSync(cache, JSON.stringify([...out]));
  return [...out];
}

const catalog = loadCatalog();
const posts = loadPosts();
const store = loadKeywordStore();
const dests = [...catalog.destinations.values()].filter(
  (d) => d.published !== false && destinationPackages(catalog, d.slug).all.length >= 2 && (!ONLY || ONLY.includes(d.slug)),
);

// Each place belongs to the destination where it weighs most (Samarkand -> Uzbekistan, not Kazakhstan).
const weights = new Map(dests.map((d) => [d.slug, placeWeights(d, destinationPackages(catalog, d.slug).all)]));
const allDests = [...catalog.destinations.values()].filter((d) => destinationPackages(catalog, d.slug).all.length >= 2);
const allWeights = new Map(allDests.map((d) => [d.slug, weights.get(d.slug) ?? placeWeights(d, destinationPackages(catalog, d.slug).all)]));
const owner = new Map();
for (const [slug, w] of allWeights)
  for (const [place, n] of w) if (!owner.has(place) || allWeights.get(owner.get(place)).get(place) < n) owner.set(place, slug);
const destNames = new Set([...catalog.destinations.values()].map((d) => normKw(d.name?.en ?? d.slug)));
const ownPlaces = (slug) =>
  [...(allWeights.get(slug) ?? new Map()).entries()].filter(([p]) => owner.get(p) === slug && !destNames.has(p)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p);

const phrases = await competitorPhrases();
console.log(`[bank] ${phrases.length} competitor title phrases`);

const bank = { ...(store.bank ?? {}), destinations: { ...(store.bank?.destinations ?? {}) } };
for (const dest of dests) {
  const pk = destinationPackages(catalog, dest.slug);
  const places = ownPlaces(dest.slug);
  const foreign = [...owner.entries()].filter(([, s]) => s !== dest.slug).map(([p]) => p);
  const name = normKw(dest.name?.en ?? dest.slug);
  const mine = phrases.filter((p) => p.split(" ").some((w) => w === name || places.includes(w)));
  // Planning-style competitor titles become extra seeds (trimmed to the first 5 words).
  const extraSeeds = [...new Set(
    mine
      .filter((p) => /\b(things to do|itinerary|best time|day trip|from|visa|cost|budget|safe|winter|summer|guide|tour|vs|how to)\b/.test(p))
      .map((p) => p.split(" ").slice(0, 5).join(" ")),
  )].slice(0, 25);
  const t0 = Date.now();
  const r = await researchTopics({
    dest, pk, catalog, posts, store, count: PER, extra: 0, bank: true,
    places, foreignPlaces: foreign, extraSeeds, competitorPhrases: mine, delayMs: 150, requirePlace: REGIONAL.has(dest.slug),
  });
  // Destinations whose tours cover one region only (China = Harbin/Jilin winter): every keyword must
  // name one of its places, so a post never promises a country-wide trip we don't run.
  const prev = new Map((bank.destinations[dest.slug] ?? []).map((e) => [e.keyword, e]));
  const entries = r.topics.map((t, i) => {
    const old = prev.get(t.keyword);
    return {
      keyword: fixYearLabels(t.keyword).text,
      destination: dest.slug,
      priority: i + 1,
      kind: t.research.kind,
      intent: t.research.intent,
      score: t.research.score,
      evidence: { sources: t.research.sources, bestAutocompleteRank: t.research.bestRank, seedsSurfacing: t.research.seeds },
      secondary: t.secondary,
      questions: t.questions,
      packages: t.packages,
      links: { destination: `/en/destinations/${dest.slug}/`, packages: t.packages.map((s) => `/en/packages/${s}/`) },
      category: t.category,
      angle: t.angle,
      status: old?.status === "used" ? "used" : "unused",
      ...(old?.status === "used" ? { slug: old.slug, usedAt: old.usedAt } : {}),
    };
  });
  // Keep used entries that the new research no longer returns (history).
  if (args["keep-used"] !== false)
    for (const old of prev.values()) if (old.status === "used" && !entries.some((e) => e.keyword === old.keyword)) entries.push(old);
  bank.destinations[dest.slug] = entries;
  console.log(
    `[bank] ${dest.slug}: ${r.stats.seeds} seeds, ${r.stats.requests} requests (${r.stats.failures} failed), ${r.stats.candidates} candidates -> ${entries.length} keywords in ${Math.round((Date.now() - t0) / 1000)}s; places ${places.join(", ")}`,
  );
  for (const e of entries.slice(0, 5)) console.log(`        ${e.priority}. ${e.keyword}  [${e.kind}, ${e.evidence.sources.join("+")}, rank ${e.evidence.bestAutocompleteRank}]`);
}
bank.generatedAt = new Date().toISOString();
bank.method =
  "Google Autocomplete + Bing Autosuggest (no keys), competitor sitemap titles as seeds/signal; ranked by autocomplete position, both-engine presence and seed frequency (demand proxy, no volumes), intent, long-tail specificity and tour overlap. Existing posts' keywords excluded.";
store.version = 2;
store.bank = bank;
saveKeywordStore(store);
const total = Object.values(bank.destinations).reduce((n, l) => n + l.filter((e) => e.status === "unused").length, 0);
console.log(`[bank] ${total} unused keywords across ${Object.keys(bank.destinations).length} destinations -> content/blog-keywords.json`);
