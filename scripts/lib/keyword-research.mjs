import { targetYear } from "./target-year.mjs";
/**
 * Keyword research for the blog generator (free sources only, no API keys).
 *
 *   Google Autocomplete   suggestqueries.google.com/complete/search?client=firefox
 *   Bing Autosuggest      api.bing.com/osjson.aspx (public OpenSearch suggestions)
 *
 * Both endpoints only return phrases people really type, so a phrase showing up there is the
 * demand signal (no search volumes are available for free). People Also Ask / related searches
 * are not used: they need SERP scraping, which Google's and Bing's terms do not allow.
 * Question-style suggestions ("how many days in ...", "is ... worth visiting") stand in for them.
 * Google Search Console query data is not used: no GSC credential exists for this project.
 *
 * Flow for one run (one destination, N posts):
 *   1. seeds = destination name and its main places x planning/commercial modifiers;
 *   2. collect suggestions from both engines (small delay between calls, cached per run);
 *   3. score each candidate: demand (engines, seeds, rank), intent (commercial/planning first),
 *      long-tail specificity, overlap with our tours/places, minus anything off-topic;
 *   4. drop cannibalising keywords: any existing post (title/slug/intent, scripts/lib/blog-core
 *      findDuplicateTopic) or any keyword already stored in content/blog-keywords.json;
 *   5. pick N primaries with different intents, then 3-5 secondary keywords and questions each.
 *
 * The result never contains supplier names (SUPPLIER_RE) or brand/platform names.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CONTENT_DIR,
  SUPPLIER_RE,
  findDuplicateTopic,
  isLinkablePackage,
  readJson,
  slugify,
  topicIntent,
  writeJson,
} from "./blog-core.mjs";

export const KEYWORDS_FILE = join(CONTENT_DIR, "blog-keywords.json");
const UA = "Mozilla/5.0 (compatible; SundayAtlasBlogBot/1.0; +https://sundayatlastravel.com)";

/* ------------------------------------------------------------------ text helpers */

/** Lowercase, ASCII-folded, punctuation to spaces: the form keywords are compared in. */
export function normKw(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** True when `text` contains the keyword as a phrase (after normKw on both). */
export function hasKeyword(text, keyword) {
  const t = ` ${normKw(text)} `;
  const k = normKw(keyword);
  if (!k) return false;
  if (t.includes(` ${k} `)) return true;
  // Tolerate singular/plural on the last word ("7 day" vs "7 days").
  const alt = k.endsWith("s") ? k.slice(0, -1) : `${k}s`;
  return t.includes(` ${alt} `);
}

const FUNCTION_WORDS = new Set("a an the to in of for from by with on at and or is are it do does what how when where which why can i you my".split(" "));
function kwTokens(text) {
  return new Set(normKw(text).split(" ").filter((w) => w && !FUNCTION_WORDS.has(w)));
}
function jac(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n / (a.size + b.size - n);
}

/* ------------------------------------------------------------------ keyword store */

export function loadKeywordStore(file = KEYWORDS_FILE) {
  if (!existsSync(file)) return { version: 1, posts: {} };
  const s = readJson(file);
  return { version: 1, posts: {}, ...s };
}
export function saveKeywordStore(store, file = KEYWORDS_FILE) {
  writeJson(file, store);
}

/** Every keyword we already target: stored choices plus each post's focus keyword and keyword list. */
export function keywordCorpus(posts, store) {
  const out = [];
  for (const [slug, e] of Object.entries(store.posts ?? {})) {
    if (e.primary) out.push({ slug, keyword: e.primary, destination: e.destination, primary: true });
    for (const k of e.secondary ?? []) out.push({ slug, keyword: k, destination: e.destination, primary: false });
  }
  for (const { post } of posts) {
    const seo = post.seo?.en ?? {};
    if (seo.focus_keyword) out.push({ slug: post.slug, keyword: seo.focus_keyword, destination: post.destination, primary: true });
    for (const k of (seo.keywords ?? []).slice(1)) out.push({ slug: post.slug, keyword: k, destination: post.destination, primary: false });
  }
  return out;
}

/**
 * Why `keyword` would cannibalise an existing post, or "" when it is free.
 * Extends the duplicate-topic guard (findDuplicateTopic on post titles/slugs/intents) with a
 * keyword-level check against every primary and secondary keyword we already target.
 */
export function keywordConflict(keyword, destination, posts, store, corpus = keywordCorpus(posts, store)) {
  const slug = slugify(keyword);
  const dup = findDuplicateTopic({ slug, title: keyword, destination }, posts);
  if (dup) return `post ${dup.post.slug}: ${dup.reason}`;
  const k = normKw(keyword);
  const kt = kwTokens(keyword);
  const ki = topicIntent(slug, keyword);
  for (const c of corpus) {
    const ck = normKw(c.keyword);
    if (!ck) continue;
    if (ck === k || ck === `${k}s` || `${ck}s` === k) return `keyword already targeted by ${c.slug} ("${c.keyword}")`;
    if (!c.primary) continue; // secondary keywords only block exact repeats
    const sim = jac(kt, kwTokens(c.keyword));
    if (sim >= 0.75) return `too close to "${c.keyword}" (${c.slug}, ${sim.toFixed(2)})`;
    if (ki.kind !== "other" && (!destination || !c.destination || c.destination === destination)) {
      const ci = topicIntent(slugify(c.keyword), c.keyword);
      if (ci.kind === ki.kind && ci.places.size && [...ci.places].every((p) => ki.places.has(p)) && ci.places.size === ki.places.size)
        return `same ${ki.kind} keyword as ${c.slug} ("${c.keyword}")`;
    }
  }
  return "";
}

/* ------------------------------------------------------------------ suggestion sources */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json,text/javascript,*/*" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

export const SOURCES = {
  google: async (q) => {
    const j = await fetchJson(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=${encodeURIComponent(q)}`);
    return Array.isArray(j?.[1]) ? j[1].filter((s) => typeof s === "string") : [];
  },
  bing: async (q) => {
    const j = await fetchJson(`https://api.bing.com/osjson.aspx?market=en-US&query=${encodeURIComponent(q)}`);
    return Array.isArray(j?.[1]) ? j[1].filter((s) => typeof s === "string") : [];
  },
};

/**
 * suggestions(seed) for every seed and source. Returns Map<normKw(suggestion), {text, hits:[{source, seed, rank}]}>.
 * `fetcher(source, seed)` can be swapped in tests.
 */
export async function collectSuggestions(seeds, { fetcher, delayMs = 120, log = () => {} } = {}) {
  const get = fetcher ?? ((source, seed) => SOURCES[source](seed));
  const out = new Map();
  const stats = { requests: 0, failures: 0, bySource: {} };
  for (const seed of seeds) {
    for (const source of Object.keys(SOURCES)) {
      stats.requests += 1;
      stats.bySource[source] ??= { ok: 0, failed: 0 };
      let list = [];
      try {
        list = await get(source, seed);
        stats.bySource[source].ok += 1;
      } catch (err) {
        stats.failures += 1;
        stats.bySource[source].failed += 1;
        log(`[keywords] ${source} "${seed}" failed: ${err.message || err}`);
      }
      list.slice(0, 10).forEach((s, rank) => {
        const k = normKw(s);
        if (!k) return;
        const e = out.get(k) ?? { text: s.toLowerCase().trim(), hits: [] };
        e.hits.push({ source, seed, rank });
        out.set(k, e);
      });
      if (delayMs) await sleep(delayMs);
    }
  }
  return { suggestions: out, stats };
}

/* ------------------------------------------------------------------ seeds and places */

const CAP_STOP = new Set(
  "Day Days Tour Tours Private The And Trip Trips Winter Summer Spring Autumn Learn Ski Active Outdoor City Cities Highlights Journey Explorer Discovery Cultural Legends Arrival Departure Transfer Free Sunday Atlas Travel Old Town Market Square National Park Mountains Mountain Lake River Valley Church Cathedral Castle Monastery Temple Mosque Street Christmas Markets Road Long Odyssey Stans Gorge Plateau Ice Festival Snow Glacier Hike Train First Greco Roman Republic Complex Basilica Western Eastern Northern Southern Polish Main Back Return Drive Morning Evening Full Half Walking Optional Leisure Hotel Airport Check Overnight Explore Visit Excursion Afternoon Sunday Bazaar UNESCO Canyon Lakes Center Centre Aliyev Heydar Island World Sophia Crater Volcanoes Time Fortress Khor Virap Caspian Silk Grand Great Classic Best Capital Region Village Villages Peninsula Symphony Zaha Hadid Walled Stones Heydar Tower Towers Seven Arch Wedding Palace Neutrality Flame Lakes"
    .split(" "),
);

/** Main places of a destination: capitalised words in its highlights and live package titles/itineraries, most frequent first. */
export function destinationPlaces(dest, packages, limit = 4) {
  return [...placeWeights(dest, packages).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([k]) => k);
}

/** Place word -> weight (how often it appears in the destination's highlights, package titles and itineraries). */
export function placeWeights(dest, packages) {
  const name = normKw(dest?.name?.en ?? dest?.slug ?? "");
  const counts = new Map();
  const add = (text, w = 1) => {
    for (const m of String(text || "").matchAll(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}’'-]{2,}(?![\p{L}\p{N}])/gu)) {
      const word = m[0].replace(/[’']s$/u, "").replace(/[’'-]+$/u, "");
      if (CAP_STOP.has(word) || /^\p{Lu}+$/u.test(word)) continue;
      const k = normKw(word);
      if (!k || k === name || k.length < 4) continue;
      counts.set(k, (counts.get(k) ?? 0) + w);
    }
  };
  for (const h of dest?.highlights?.en ?? []) add(h.split(/[:—–(]/)[0], 2);
  for (const p of packages) {
    add(p.title?.en, 2);
    for (const d of p.itinerary ?? []) add(d.title?.en, 1);
  }
  return counts;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function seedsFor(destName, places, now = new Date(), { bank = false } = {}) {
  const X = normKw(destName);
  const nextMonth = MONTHS[(now.getUTCMonth() + 1) % 12];
  const season = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"][(now.getUTCMonth() + 1) % 12];
  const seeds = [
    `things to do in ${X}`,
    `${X} itinerary`,
    `best time to visit ${X}`,
    `${X} trip cost`,
    `${X} travel cost`,
    `${X} tour`,
    `${X} private tour`,
    `${X} tour package`,
    `${X} visa`,
    `how to get to ${X}`,
    `how many days in ${X}`,
    `is ${X} worth visiting`,
    `${X} in ${season}`,
    `${X} in ${nextMonth}`,
    `${X} travel tips`,
    `${X} vs`,
    `where to go in ${X}`,
    `${X} road trip`,
  ];
  for (const p of places) {
    seeds.push(`things to do in ${p}`, `${p} day trip`, `day trip from ${p}`, `${p} itinerary`, `how to get to ${p}`, `${p} in ${season}`);
  }
  if (bank) {
    // Keyword bank (built once, used for months): every season and the long-tail planning modifiers.
    seeds.push(
      `${X} itinerary 5 days`, `${X} itinerary 7 days`, `${X} itinerary 10 days`, `${X} itinerary 2 weeks`,
      `${X} in winter`, `${X} in spring`, `${X} in summer`, `${X} in autumn`, `${X} weather by month`,
      `is ${X} safe`, `is ${X} expensive`, `${X} visa for`, `${X} travel guide`, `${X} on a budget`,
      `${X} tour packages from`, `${X} holidays`, `${X} vacation`, `${X} with kids`, `${X} food`,
      `${X} hiking`, `${X} culture`, `${X} travel itinerary`, `what to see in ${X}`, `top places to visit in ${X}`,
      `best places to visit in ${X}`, `${X} or`, `${X} for first time`, `${X} solo travel`, `${X} family trip`,
    );
    for (const p of places)
      seeds.push(
        `${p} itinerary 2 days`, `${p} itinerary 3 days`, `best time to visit ${p}`, `what to see in ${p}`,
        `${p} to`, `${p} tour`, `is ${p} worth visiting`, `${p} in winter`, `${p} in summer`, `${p} travel guide`,
      );
  }
  return [...new Set(seeds)];
}

/* ------------------------------------------------------------------ scoring */

const INTENT_RULES = [
  { kind: "commercial", w: 3, re: /\b(tours?|private tour|tour packages?|packages?|guided|holidays?|vacations?|trip cost|cost|costs|price|prices|budget|expensive|cheap)\b/ },
  { kind: "planning", w: 2.5, re: /\b(itinerary|itineraries|\d+ days?|how many days|best time|when to|day trips?|things to do|what to do|where to go|how to get|road trip|route|visa|in (winter|spring|summer|autumn|fall|january|february|march|april|may|june|july|august|september|october|november|december)|christmas|ski|skiing|hiking|trek|worth visiting|travel tips|from \w+ to \w+|weekend|vs|versus)\b/ },
  { kind: "informational", w: 1, re: /\b(weather|safe|safety|is it|what is|history|facts|tips)\b/ },
];
/** Brands, platforms, news and other things we should not target. */
const OFF_TOPIC_RE =
  /\b(reddit|rick steves|lonely planet|trip advisor|booking com|ryanair|wizz|lot airlines|easyjet|youtube|wiki|wikipedia|quora|map|maps|flag|population|news|war|army|military|earthquake|protest|election|president|football|soccer|song|lyrics|movie|film|game|olympics|cruise|tickets?|flights?|airlines?|airfare|hotels?|hostels?|forecast|cost of living|reviews?|operators?|agency|agencies|colombia|ireland|costa rica|nc|dinner|rates|with car|pamir discovery|suits|what time is it|days off|for \d+ days|car rental|rent a car|bus schedule|train schedule|sim card|esim|stock|jobs?|salary|university|apartment|apartments|real estate|rent|for sale|girls?|women|dating|wife|porn|sex|casino|crypto|today|live|webcam|weather today|time zone|time now|currency to|exchange rate|code|zip|postal|phone|embassy in|consulate|passport photo|online application|form|citizenship|resident|work permit|immigration|refugee|meaning|pronunciation|translate|language|capital of|reddit)\b/;
const QUESTION_RE = /^(how|what|when|where|which|why|is|are|can|do|does|should|will)\b/;

export function scoreCandidate(k, entry, ctx) {
  const words = k.split(" ").length;
  const reasons = [];
  const google = entry.hits.some((h) => h.source === "google");
  const bing = entry.hits.some((h) => h.source === "bing");
  const seeds = new Set(entry.hits.map((h) => h.seed)).size;
  const bestRank = Math.min(...entry.hits.map((h) => h.rank));
  const demand = (google && bing ? 1.5 : 1) + Math.min(seeds - 1, 3) * 0.5 + (10 - bestRank) / 10;
  let intent = 0;
  let intentKind = "other";
  for (const r of INTENT_RULES)
    if (r.re.test(k)) {
      intent = r.w;
      intentKind = r.kind;
      break;
    }
  const specificity = words <= 2 ? -2 : words <= 7 ? 1.5 : words <= 9 ? 0.5 : -1;
  const toks = k.split(" ");
  const placeHits = ctx.places.filter((p) => toks.includes(p) || k.includes(p)).length;
  const tourHits = [...ctx.tourTokens].filter((t) => toks.includes(t)).length;
  const overlap = Math.min(2, placeHits) + Math.min(1, tourHits * 0.5) + (toks.includes(ctx.destTok) ? 0.5 : 0);
  // Readability: "best time to visit poland krakow" makes a clumsy H1; "krakow poland" reads fine.
  const di = toks.indexOf(ctx.destTok);
  const awkward = di >= 0 && di < toks.length - 1 && ctx.places.includes(toks[di + 1]) ? -1.5 : 0;
  // A cost post needs real catalog prices; destinations with only price-on-request tours skip it.
  const noPrices = !ctx.hasPrices && keywordKind(k) === "costs" ? -4 : 0;
  reasons.push(`demand ${demand.toFixed(1)}`, `intent ${intentKind} ${intent}`, `specific ${specificity}`, `overlap ${overlap.toFixed(1)}`);
  if (awkward) reasons.push("awkward word order");
  if (noPrices) reasons.push("no catalog prices for a cost post");
  return { score: Number((demand * 2 + intent + specificity + overlap + awkward + noPrices).toFixed(2)), intentKind, demand, google, bing, seeds, bestRank, reasons };
}

/** Candidates for a destination that are on-topic, unbranded and not stale. */
export function filterCandidates(suggestions, ctx, { now = new Date() } = {}) {
  const year = now.getUTCFullYear();
  const out = [];
  for (const [k, entry] of suggestions) {
    const toks = k.split(" ");
    const onTopic = toks.includes(ctx.destTok) || ctx.places.some((p) => k.includes(p));
    if (!onTopic) continue;
    if (OFF_TOPIC_RE.test(k)) continue;
    if (SUPPLIER_RE.test(k) || SUPPLIER_RE.test(entry.text)) continue;
    // Another of our destinations: separate post, except comparisons ("kazakhstan vs kyrgyzstan").
    if (ctx.otherDestinations.some((d) => toks.includes(d)) && !/\b(vs|versus|or)\b/.test(k)) continue;
    if (ctx.foreignPlaces?.some((p) => toks.includes(p)) && !ctx.places.some((p) => toks.includes(p))) continue;
    const years = [...k.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
    // Freshness: keywords labelled with a year older than the target year (next year from November) are stale.
    if (years.some((y) => y < targetYear(now))) continue;
    if (/\b(tailor made|bespoke|curated)\b/.test(k)) continue;
    // "tours by <company>": another operator's brand.
    if (/\bby (?!(train|bus|car|plane|air|road|month|season|night|day)\b)\w+/.test(k)) continue;
    // Comparisons only against our own destinations or places ("kazakhstan vs kyrgyzstan").
    if (/\b(vs|versus)\b/.test(k)) {
      const other = k.split(/\b(?:vs|versus)\b/).map((x) => x.trim()).find((x) => !x.split(" ").includes(ctx.destTok) && !ctx.places.some((p) => x.split(" ").includes(p)));
      if (other && !ctx.otherDestinations.some((d) => other.split(" ").includes(d)) && !(ctx.foreignPlaces ?? []).some((p) => other.split(" ").includes(p))) continue;
    }
    if (k.length > 70) continue;
    out.push({ keyword: k, text: entry.text, entry, question: QUESTION_RE.test(k) });
  }
  return out;
}

/** Topic kind used for variety (one per kind in a run). */
export function keywordKind(k) {
  if (/\bthings to do|what to do\b/.test(k)) return "things-to-do";
  if (/\bbest time|when to\b|\bin (winter|spring|summer|autumn|fall|january|february|march|april|may|june|july|august|september|october|november|december)\b|christmas/.test(k)) return "season";
  if (/itinerar|\d+ days?|how many days|road trip|route/.test(k)) return "itinerary";
  if (/day trips?|from \w+ to/.test(k)) return "day-trip";
  if (/\b(cost|costs|price|prices|budget|expensive|cheap)\b/.test(k)) return "costs";
  if (/\bvisa\b|how to get/.test(k)) return "practical";
  if (/\b(tours?|packages?|guided)\b/.test(k)) return "tours";
  if (/\bski|hiking|trek/.test(k)) return "activity";
  if (/\b(vs|versus)\b/.test(k)) return "compare";
  if (/\b(safe|safety)\b/.test(k)) return "safety";
  return "other";
}

/** Same category ids blog posts use. */
function categoryFor(kind) {
  return { "things-to-do": "top-places", season: "seasonal", "day-trip": "day-trips", activity: "day-trips" }[kind] ?? "destination-guide";
}

/** Live packages ordered by how well they match the keyword (place words in title/itinerary), then the destination's own. */
export function packagesFor(keyword, pk) {
  const toks = new Set(normKw(keyword).split(" ").filter((t) => t.length > 3 && !/^(trip|trips|tour|tours|from|days|with|what|things|best|time|visit|worth|package|packages|private|city)$/.test(t)));
  const text = (p) => normKw([p.title?.en, ...(p.itinerary ?? []).map((d) => d.title?.en)].join(" "));
  const scored = pk.all.map((p, i) => ({ p, s: [...toks].filter((t) => text(p).includes(t)).length * 10 - i }));
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.p.slug).slice(0, 4);
}

function angleFor(keyword, destName, kind) {
  const base = {
    "things-to-do": `What to see and do, grouped by area, with drive times and which of our ${destName} tours covers each`,
    season: `Month-by-month conditions, what is open and which of our ${destName} tours fit the season`,
    itinerary: `A day-by-day route that answers the search, built from our ${destName} tours, with realistic drive times`,
    "day-trip": `How the day works: distances, drive times, what you see and how to book it privately`,
    costs: `What drives the cost of the trip; real tour prices only from our catalog, no invented prices`,
    practical: `Practical answer first, then the steps a first-time visitor to ${destName} needs`,
    tours: `Which private tour fits which traveller, with lengths, seasons and what is included`,
    activity: `Where, when and how hard, with the tours that include it`,
    compare: `A fair side-by-side for choosing: landscapes, seasons, travel times and which of our tours fit each`,
    safety: `A direct, factual answer first, then practical precautions and how a private tour with a driver-guide helps; no invented statistics`,
  }[kind];
  return base ?? `Answer the search "${keyword}" directly, then give the planning detail behind it`;
}

/**
 * Research keywords for one destination and return up to `count` topics (best first), each with
 * a primary keyword, 3-5 secondary keywords and questions. Never throws: on network failure it
 * returns { topics: [], stats } and the caller falls back to the template/queue topics.
 */
export async function researchTopics({
  dest, pk, catalog, posts, store, count = 3, extra = 3, fetcher, now = new Date(), log = () => {},
  places: placesIn, foreignPlaces = [], extraSeeds = [], competitorPhrases = [], bank = false, delayMs, requirePlace = false,
}) {
  const destName = dest?.name?.en ?? dest?.slug;
  const places = placesIn ?? destinationPlaces(dest, pk.all);
  const ctx = {
    destTok: normKw(destName),
    places,
    tourTokens: new Set(
      pk.all.flatMap((p) => normKw(p.title?.en).split(" ")).filter((t) => t.length > 3 && !FUNCTION_WORDS.has(t) && !/^(days?|tour|private|trip)$/.test(t)),
    ),
    hasPrices: pk.all.some((p) => typeof p.priceFrom === "number"),
    otherDestinations: [...catalog.destinations.values()].filter((d) => d.slug !== dest.slug).map((d) => normKw(d.name?.en ?? d.slug)),
    foreignPlaces,
  };
  const seeds = [...new Set([...seedsFor(destName, places, now, { bank }), ...extraSeeds.map(normKw).filter(Boolean)])];
  const { suggestions, stats } = await collectSuggestions(seeds, { fetcher, log, ...(delayMs != null ? { delayMs } : {}) });
  // Competitor post titles/URLs: a keyword whose words all appear in one of them is a proven topic.
  const compSets = competitorPhrases.map((t) => new Set(normKw(t).split(" ").filter((w) => w && !FUNCTION_WORDS.has(w))));
  const competitorHit = (k) => {
    const w = [...kwTokens(k)];
    return w.length >= 2 && compSets.some((set) => w.every((x) => set.has(x)));
  };
  const corpus = keywordCorpus(posts, store);
  // Place popularity (demand proxy): how often a place shows up in suggestions for destination-only
  // seeds ("poland itinerary" -> "poland itinerary krakow"). Head places rank above obscure ones.
  const placePop = new Map(places.map((p) => [p, 0]));
  for (const [k, e] of suggestions) {
    if (!e.hits.some((h) => !places.some((p) => h.seed.includes(p)))) continue;
    for (const p of places) if (k.split(" ").includes(p)) placePop.set(p, placePop.get(p) + 1);
  }
  const popBonus = (k) => {
    const t = k.split(" ");
    const hit = places.filter((p) => t.includes(p));
    if (!hit.length) return t.includes(ctx.destTok) ? 1.5 : 0;
    return Math.min(2, Math.max(...hit.map((p) => placePop.get(p) ?? 0)) * 0.2);
  };
  // A place searched together with the destination name ("harbin china") is that place.
  const withDest = new Map(places.map((p) => [p, 0]));
  for (const k of suggestions.keys()) {
    const t = k.split(" ");
    if (t.includes(ctx.destTok)) for (const p of places) if (t.includes(p)) withDest.set(p, withDest.get(p) + 1);
  }
  // An obscure place alone is ambiguous ("jura"): it needs the destination name in the keyword.
  const unambiguous = (k) => {
    const t = k.split(" ");
    return t.includes(ctx.destTok) || places.some((p) => t.includes(p) && ((placePop.get(p) ?? 0) >= 2 || (withDest.get(p) ?? 0) >= 4));
  };
  const scored = filterCandidates(suggestions, ctx, { now })
    .filter((c) => !bank || unambiguous(c.keyword))
    .filter((c) => !requirePlace || places.some((p) => c.keyword.split(" ").includes(p)))
    .map((c) => {
      const sc = scoreCandidate(c.keyword, c.entry, ctx);
      const comp = competitorHit(c.keyword);
      const pop = bank ? popBonus(c.keyword) : 0;
      return { ...c, ...sc, score: Number((sc.score + (comp ? 1 : 0) + pop).toFixed(2)), competitor: comp, kind: keywordKind(c.keyword) };
    })
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
  // Same search intent = same kind + same places + same season/month/number words.
  const placeSet = new Set([ctx.destTok, ...places]);
  const intentKey = (k) => {
    const t = normKw(k).split(" ");
    const extra = t.filter((w) => MONTHS.includes(w) || /^(winter|spring|summer|autumn|fall|christmas|budget|safe|visa|vs|food|hiking|ski|skiing|kids|family|solo|cost|price|tour|tours|packages?)$/.test(w));
    return [keywordKind(k), t.filter((w) => placeSet.has(w)).sort().join("+"), extra.sort().join("+")].join("|");
  };
  const rejected = [];
  const primaries = [];
  const want = count + extra;
  // Variety: first one per kind, then fill. Questions make poor titles/slugs; they become secondaries.
  for (const pass of [(c) => !primaries.some((p) => p.kind === c.kind), () => true]) {
    for (const c of scored) {
      if (primaries.length >= want) break;
      // Questions make awkward titles in live runs; the bank allows the planning ones ("is X safe").
      if (primaries.includes(c) || !pass(c)) continue;
      if (c.question && !(bank && /^(is|how many days|how to get|when to|what to see|what to do|where to)\b/.test(c.keyword))) continue;
      if (c.intentKind === "other" || c.keyword.split(" ").length < 3) continue;
      const why = keywordConflict(c.keyword, dest.slug, posts, store, corpus);
      if (why) {
        rejected.push({ keyword: c.keyword, reason: why });
        continue;
      }
      // Not two primaries for the same search in one run.
      const pseudo = primaries.map((p) => ({ post: { slug: slugify(p.keyword), title: { en: p.keyword }, destination: dest.slug } }));
      const clash = findDuplicateTopic({ slug: slugify(c.keyword), title: c.keyword, destination: dest.slug }, pseudo);
      const close = primaries.find((p) => jac(kwTokens(p.keyword), kwTokens(c.keyword)) >= 0.6 || intentKey(p.keyword) === intentKey(c.keyword));
      if (clash || close) continue;
      primaries.push(c);
    }
  }
  // Route questions ("how to get from X to Y") only when every place they name is in our catalog
  // text for this destination, so a post never answers how to reach somewhere no tour goes.
  const catalogVocab = new Set(normKw(JSON.stringify([dest, pk.all])).split(" "));
  const routeOk = (k) => {
    const m = /\bget (?:from|to) (.+)$/.exec(k);
    return !m || m[1].split(" ").every((w) => FUNCTION_WORDS.has(w) || catalogVocab.has(w));
  };
  const usable = scored.filter((c) => routeOk(c.keyword));
  // Bank: priority order = score (demand proxy + intent + specificity), not pick order.
  if (bank) primaries.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
  const usedAsPrimary = new Set(primaries.map((p) => p.keyword));
  const topics = [];
  for (const p of primaries) {
    const pt = kwTokens(p.keyword);
    const related = usable
      .filter((c) => !usedAsPrimary.has(c.keyword) && c.keyword !== p.keyword)
      .map((c) => ({ c, sim: jac(pt, kwTokens(c.keyword)) + (c.kind === p.kind ? 0.2 : 0) }))
      .filter((x) => x.sim >= 0.25)
      .sort((a, b) => b.sim - a.sim || b.c.score - a.c.score);
    const secondary = related.filter((x) => !x.c.question).slice(0, 4).map((x) => x.c.keyword);
    let questions = related.filter((x) => x.c.question).slice(0, 4).map((x) => x.c.keyword);
    if (questions.length < 2)
      questions = [...new Set([...questions, ...usable.filter((c) => c.question && !questions.includes(c.keyword)).slice(0, 3 - questions.length).map((c) => c.keyword)])];
    while (secondary.length < 3) {
      const more = usable.find((c) => !c.question && !usedAsPrimary.has(c.keyword) && !secondary.includes(c.keyword) && c.keyword !== p.keyword);
      if (!more) break;
      secondary.push(more.keyword);
    }
    topics.push({
      id: slugify(p.keyword),
      keyword: p.keyword,
      destination: dest.slug,
      countries: [],
      category: categoryFor(p.kind),
      packages: packagesFor(p.keyword, pk),
      angle: angleFor(p.keyword, destName, p.kind),
      status: "pending",
      source: "keyword-research",
      secondary: secondary.slice(0, 5),
      questions: questions.slice(0, 4),
      research: {
        score: p.score,
        kind: p.kind,
        intent: p.intentKind,
        sources: [p.google && "google", p.bing && "bing", p.competitor && "competitor-titles"].filter(Boolean),
        seeds: p.seeds,
        bestRank: p.bestRank + 1,
        reasons: p.reasons,
      },
    });
  }
  return {
    topics,
    stats: { ...stats, seeds: seeds.length, places, placePopularity: Object.fromEntries(placePop), candidates: scored.length, rejected: rejected.slice(0, 20) },
  };
}

/** Packages that may be linked (priced or price on request) for one destination. */
export function linkablePackagesFor(catalog, slug) {
  const live = [...catalog.packages.values()].filter(isLinkablePackage);
  const price = (p) => (typeof p.priceFrom === "number" ? p.priceFrom : Number.POSITIVE_INFINITY);
  const own = live.filter((p) => p.destination === slug).sort((a, b) => price(a) - price(b) || a.slug.localeCompare(b.slug));
  const shared = live.filter((p) => p.destination !== slug && (p.countries ?? []).includes(slug)).sort((a, b) => price(a) - price(b));
  return { own, shared, all: [...own, ...shared] };
}

/** First sentence of a text (up to the first . ? ! followed by a space). */
export function firstSentence(text) {
  const t = String(text || "").trim();
  const m = t.match(/^[\s\S]*?[.?!](?=\s|$)/);
  return (m ? m[0] : t).trim();
}

/**
 * SEO placement gate: the primary keyword must be in the title (H1), the slug, the meta
 * description and the first sentence of the intro (English).
 */
export function keywordProblems({ title, slug, seoDescription, intro }, keyword) {
  const problems = [];
  if (!keyword) return problems;
  if (!hasKeyword(title, keyword)) problems.push(`primary keyword "${keyword}" missing from title/H1`);
  if (!hasKeyword(String(slug || "").replace(/-/g, " "), keyword)) problems.push(`primary keyword missing from slug ${slug}`);
  if (!hasKeyword(seoDescription, keyword)) problems.push(`primary keyword missing from meta description`);
  if (!hasKeyword(firstSentence(intro), keyword)) problems.push(`primary keyword missing from the first sentence`);
  return problems;
}

/* ------------------------------------------------------------------ keyword bank (built once) */

/**
 * Next topics from the keyword bank (content/blog-keywords.json "bank", built by
 * scripts/build-keyword-bank.mjs) for one destination: unused entries in priority order, skipping
 * any keyword an existing post already covers; one per kind first so a run has variety.
 */
export function bankTopics(store, slug, { catalog, posts, count = 3, reserves = 3 } = {}) {
  const list = store?.bank?.destinations?.[slug] ?? [];
  const corpus = keywordCorpus(posts, store);
  const linkable = linkablePackagesFor(catalog, slug).all.map((p) => p.slug);
  const covered = [];
  const usable = [];
  for (const e of [...list].sort((a, b) => a.priority - b.priority)) {
    if (e.status !== "unused") continue;
    const why = keywordConflict(e.keyword, slug, posts, store, corpus);
    if (why) {
      covered.push({ keyword: e.keyword, reason: why });
      continue;
    }
    const pkgs = (e.packages ?? []).filter((s) => isLinkablePackage(catalog.packages.get(s)));
    for (const s of linkable) if (pkgs.length < 4 && !pkgs.includes(s)) pkgs.push(s);
    if (pkgs.length < 2) continue;
    usable.push({
      id: slugify(e.keyword),
      keyword: e.keyword,
      destination: slug,
      countries: [],
      category: e.category ?? categoryFor(e.kind ?? keywordKind(e.keyword)),
      packages: pkgs,
      angle: e.angle ?? angleFor(e.keyword, catalog.destinations.get(slug)?.name?.en ?? slug, e.kind ?? keywordKind(e.keyword)),
      status: "pending",
      source: "keyword-bank",
      secondary: e.secondary ?? [],
      questions: e.questions ?? [],
      research: { score: e.score, kind: e.kind, intent: e.intent, sources: e.evidence?.sources ?? [], priority: e.priority, ...(e.itineraryIntent ? { itineraryIntent: true, itineraryDays: e.itineraryDays ?? 0 } : {}) },
      ...(e.itineraryIntent ? { itineraryIntent: true, itineraryDays: e.itineraryDays ?? 0 } : {}),
    });
  }
  const want = count + reserves;
  const picked = [];
  // Itinerary-intent first: while any remain, every run writes at least one "[place] itinerary N days"
  // post (Search Console: these searches earn impressions). Best one leads the run; a second one sits
  // in the reserves so a failed first attempt is replaced by another itinerary topic.
  const itin = usable.filter((t) => t.itineraryIntent).sort((a, b) => (b.research.score ?? 0) - (a.research.score ?? 0) || a.research.priority - b.research.priority);
  if (itin[0]) picked.push(itin[0]);
  for (const pass of [(t) => !t.itineraryIntent && !picked.some((p) => p.research.kind === t.research.kind), (t) => !t.itineraryIntent, () => true])
    for (const t of usable) {
      if (picked.length >= want) break;
      if (picked.includes(t) || !pass(t)) continue;
      // Never two near-duplicates in one run.
      if (picked.some((p) => jac(kwTokens(p.keyword), kwTokens(t.keyword)) >= 0.6)) continue;
      picked.push(t);
    }
  // Keep priority order within the run, itinerary lead first; one more itinerary topic as the first reserve.
  const lead = picked[0]?.itineraryIntent ? picked.shift() : null;
  picked.sort((a, b) => a.research.priority - b.research.priority);
  if (lead) picked.unshift(lead);
  const spare = itin.find((t) => t !== lead && !picked.slice(0, count).includes(t) && (!lead || jac(kwTokens(lead.keyword), kwTokens(t.keyword)) < 0.6));
  if (lead && spare) {
    const rest = picked.filter((t) => t !== spare);
    rest.splice(Math.min(count, rest.length), 0, spare);
    picked.length = 0;
    picked.push(...rest.slice(0, want));
  }
  return { topics: picked, stats: { unused: usable.length, covered, itineraryUnused: itin.length } };
}

/** Mark a bank keyword used by a published post. */
export function markBankUsed(store, destination, keyword, slug, when = new Date().toISOString()) {
  const e = (store?.bank?.destinations?.[destination] ?? []).find((x) => normKw(x.keyword) === normKw(keyword));
  if (!e) return false;
  e.status = "used";
  e.slug = slug;
  e.usedAt = when;
  return true;
}

/** Unused bank keywords per destination. */
export function bankRemaining(store) {
  return Object.fromEntries(
    Object.entries(store?.bank?.destinations ?? {}).map(([d, l]) => [d, l.filter((e) => e.status === "unused").length]),
  );
}
