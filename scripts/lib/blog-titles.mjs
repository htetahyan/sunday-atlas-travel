/**
 * Clickable, honest blog titles and meta descriptions (Search Console: our itinerary post sat at
 * position ~8 with 0 clicks while competitors with sharper titles won them).
 *
 * Pattern for every post:
 *   title (H1) = seo_title = og:title, max 60 characters, starting with the exact search phrase,
 *   then concrete places/days, at most one honest hook the post delivers, and the target year:
 *     "Uzbekistan Itinerary 5 Days: Tashkent, Samarkand & Chimgan (2027)"
 *   meta description 140-155 characters: the search phrase, a concrete promise (route, day count,
 *   times, months), who it suits, a soft call to action.
 * No "guide" (Htet: say travel blog/posts), no clickbait, no tailor-made/bespoke/curated, no prices.
 */
import { itineraryDays } from "./blog-core.mjs";
import { keywordKind, normKw, hasKeyword } from "./keyword-research.mjs";

export const BANNED_TITLE_RE = /\b(guides?|ultimate|complete|secrets?|hidden gems?|you won'?t believe|best ever|must[- ]see|tailor[- ]made|bespoke|curated)\b|[?!]/i;
export const BANNED_DESC_RE = /\b(guides?|tailor[- ]made|bespoke|curated|within \d+ hours|24 ?h(ours)?)\b|[$€£¥]|\bUSD\b/i;
export const SEO_TITLE_MAX = 60;

export const titleCase = (s) =>
  String(s).replace(/\b([a-z])([a-z]*)/g, (m, a, b, off) => (off > 0 && /^(and|or|in|of|to|the|a|an|for|from|by|vs)$/.test(m) ? m : a.toUpperCase() + b));

export const TITLE_RULES = (primary, year) =>
  [
    `CLICKABLE TITLE (title, seoTitle and the social title are the same string, so Google shows it as written): max ${SEO_TITLE_MAX} characters;`,
    `start with the exact primary keyword "${primary}" in Title Case; after a colon give concrete specifics this post really contains (2-3 real place names on the route, a day count, a number of places);`,
    "optionally ONE honest hook the post delivers (e.g. First-Timer Route, No Domestic Flights, Day-by-Day Plan, Month by Month, By Train);",
    `end with (${year}). Never use: guide, ultimate, complete, secret, hidden gem, must-see, tailor-made, bespoke, curated; no question or exclamation marks; no prices; nothing the post does not deliver.`,
  ].join(" ");

export const DESCRIPTION_RULES = (primary) =>
  [
    `META DESCRIPTION (seoDescription): 140-155 characters; contains the exact phrase "${primary}";`,
    "a concrete promise of what is inside (the route, day count, drive or train times, best months, a sample day) taken from this post;",
    "who it suits (first-time visitors, families, winter travellers...) only if true; end with a soft call to action such as \"See the day-by-day plan.\" or \"Plan your route.\"",
    "No prices, no reply-time promises, never the words guide, tailor-made, bespoke or curated.",
  ].join(" ");

/** Title problems for a generated outline ({title, seoTitle, seoDescription, sections}); [] when fine. */
export function clickableTitleProblems(outline, primary, year, itin = null) {
  const out = [];
  const t = String(outline.title ?? "").trim();
  const k = normKw(primary);
  const nt = normKw(t);
  const startsOk = nt.startsWith(k) || nt.startsWith(k.endsWith("s") ? k.slice(0, -1) : `${k}s`);
  if (!startsOk) out.push(`title must start with the exact keyword "${primary}"`);
  if (t.length > SEO_TITLE_MAX) out.push(`title is ${t.length} characters (max ${SEO_TITLE_MAX})`);
  if (!t.includes(String(year))) out.push(`title must end with (${year})`);
  // Words that are part of the search phrase itself ("harbin tour guide") are allowed.
  const strip = (x) => (primary ? x.replace(new RegExp(primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+"), "gi"), "") : x);
  if (BANNED_TITLE_RE.test(strip(t))) out.push(`title uses a banned word or mark (${strip(t).match(BANNED_TITLE_RE)[0]})`);
  const d = String(outline.seoDescription ?? "").trim();
  if (d.length < 120 || d.length > 160) out.push(`seoDescription is ${d.length} characters (140-155)`);
  if (BANNED_DESC_RE.test(strip(d))) out.push(`seoDescription uses a banned word (${strip(d).match(BANNED_DESC_RE)[0]})`);
  if (primary && !hasKeyword(d, primary)) out.push("seoDescription must contain the primary keyword");
  if (itin) {
    const dayHeads = (outline.sections ?? []).filter((s) => /^Days? \d/i.test(String(s.heading ?? "").trim())).length;
    const need = itin.days > 5 ? 4 : Math.min(itin.days, 4);
    if (dayHeads < need) out.push(`itinerary post needs ${need}+ day-by-day section headings ("Day 1: ...", got ${dayHeads})`);
  }
  return out;
}

/** In-place clean-up: year label, "(2027 Guide)" -> "(2027)", seoTitle = title when it fits. */
export function normalizeTitles(outline, year) {
  if (typeof outline.title !== "string") return outline;
  outline.title = outline.title
    .replace(new RegExp(`\\(\\s*${year}\\s+(Travel\\s+)?Guide\\s*\\)`, "i"), `(${year})`)
    .replace(/\s+/g, " ")
    .trim();
  if (outline.title.length <= SEO_TITLE_MAX) outline.seoTitle = outline.title;
  return outline;
}

/** Is this topic an itinerary search, and how should the plan be laid out? null when not. */
export function itineraryPlan(topic, live, year) {
  const kw = String(topic.keyword ?? "");
  const flagged = topic.research?.itineraryIntent || topic.itineraryIntent;
  const looks = keywordKind(normKw(kw)) === "itinerary" && /itinerar|\b\d+ (days?|weeks?) in\b|\bin \d+ (days?|weeks?)\b/i.test(kw);
  if (!flagged && !looks) return null;
  const toks = new Set(normKw(kw).split(" ").filter((w) => w.length > 3 && !/^(itinerary|days|weeks|travel|trip)$/.test(w)));
  const wanted = topic.research?.itineraryDays || itineraryDays(kw) || 0;
  const text = (p) => normKw([p.title?.en, ...(p.itinerary ?? []).map((d) => d.title?.en)].join(" "));
  const multi = live.filter((p) => (p.durationDays ?? 1) > 1);
  const pool = multi.length && wanted !== 1 ? multi : live;
  const scored = pool
    .map((p) => ({ p, s: [...toks].filter((t) => text(p).includes(t)).length * 10 - (wanted ? Math.abs((p.durationDays ?? 1) - wanted) : 0) }))
    .sort((a, b) => b.s - a.s);
  const tour = scored[0]?.p;
  const days = wanted || tour?.durationDays || 5;
  const layout =
    days <= 2
      ? `Sections 1-4: the ${days === 1 ? "day" : "two days"} in order, split by part of day, headings like "Day 1 Morning: ...", "Day 1 Afternoon: ..."${days === 2 ? ', "Day 2 Morning: ..."' : ""}; sections 5-6: getting there and around, and which of our tours runs this route.`
      : days <= 5
        ? `Sections 1-${days}: one per day, headings "Day 1: <where> and <main stops>" ... "Day ${days}: ..."; the remaining ${6 - days} section(s): getting between places (train/drive times) and which of our tours runs this route, with where to stay${6 - days > 1 ? " and the best months" : ""}.`
        : `Sections 1-5: every one of the ${days} days in order, grouped ("Days 1-2: ...", "Days 3-4: ...", up to "Day ${days}" or "Days ${days - 1}-${days}"), no day skipped; section 6: which of our tours runs this route and the practical details (best months, train/drive times).`;
  const brief = [
    `ITINERARY POST: a real day-by-day plan for ${days} day${days > 1 ? "s" : ""} that answers "${kw}".`,
    layout,
    "Each day says where it starts and ends, the main stops in order, realistic drive or train times, and where you sleep that night. The intro's first sentence gives the whole route in one line (e.g. \"two days in Tashkent, a day in Samarkand by high-speed train, ...\").",
    "Base the route on the places and order our tours really use (tour facts above). For days no tour covers, use well-known routes and never claim a tour does them.",
    tour
      ? `Matching Sunday Atlas tour for this route: ${tour.slug} ("${tour.title?.en}", ${tour.durationDays === 1 ? "1 day" : `${tour.durationDays} days`}). Set it as packageSlug on the last day section and on the final section, and say plainly how it differs from this plan if the length or stops differ.`
      : "",
    "Add one FAQ answering how many days the destination needs.",
  ].filter(Boolean).join("\n");
  const example = `the shape of "Uzbekistan Itinerary 5 Days: Tashkent, Samarkand & Bukhara (${year})", starting with "${titleCase(kw)}" and naming this route's real stops`;
  return { days, tour: tour?.slug ?? "", brief, example };
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Deterministic repair so a good post is never dropped for a long or slightly off title (2-3 Nov:
 * every post failed "title is 74 characters (max 60)" after the one AI rewrite). Keeps the rules'
 * intent: starts with the keyword, real specifics from the model's own title, ends with (year),
 * no banned words, <= 60 characters; meta description trimmed at a sentence/word boundary.
 * Mutates and returns outline.
 */
export function repairTitles(outline, primary, year) {
  const kwTitle = titleCase(String(primary ?? "").trim());
  let t = String(outline.title ?? "").replace(/\s+/g, " ").trim();
  // Drop any year label / trailing parenthetical, banned words and ?! marks from the specifics.
  t = t.replace(/\((?:[^()]*\b(?:19|20)\d{2}\b[^()]*)\)\s*$/g, "").replace(/\s*[-–|]\s*(?:19|20)\d{2}\s*$/, "").trim();
  t = t.replace(new RegExp(`\\b(?:19|20)\\d{2}\\b`, "g"), (y) => (y === String(year) ? "" : y)).trim();
  const kwRe = primary ? new RegExp(`^${escRe(primary).replace(/\s+/g, "[\\s-]+")}s?`, "i") : null;
  let rest = kwRe && kwRe.test(t) ? t.replace(kwRe, "") : t;
  if (kwRe && !kwRe.test(t)) {
    // Keyword missing at the start: keep only what follows a colon (the specifics), if any.
    rest = t.includes(":") ? t.slice(t.indexOf(":") + 1) : "";
  }
  rest = rest
    .replace(/^[\s:,–-]+/, "")
    .replace(BANNED_TITLE_RE, "")
    .replace(new RegExp(BANNED_TITLE_RE.source, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,:&–-]+$/, "")
    .trim();
  const suffix = ` (${year})`;
  const build = (spec) => `${kwTitle}${spec ? `: ${spec}` : ""}${suffix}`;
  let spec = rest;
  if (spec && build(spec).length > SEO_TITLE_MAX) {
    // First drop list items that only repeat the keyword ("Harbin Itinerary 7 Days: Harbin, ...").
    const items = spec.split(/\s*(?:,|&)\s*/).filter(Boolean);
    const kwWords = new Set(normKw(primary).split(" "));
    const kept = items.filter((x) => !normKw(x).split(" ").every((w) => kwWords.has(w)));
    if (kept.length && kept.length < items.length)
      spec = kept.length > 1 ? `${kept.slice(0, -1).join(", ")} & ${kept.at(-1)}` : kept[0];
  }
  while (spec && build(spec).length > SEO_TITLE_MAX) {
    // Drop the last list item / clause first, then the last word.
    const items = spec.split(/\s*(?:,|&|\bwith\b|–| - )\s*/i).filter(Boolean);
    if (items.length > 1) {
      items.pop();
      spec = items.length > 1 ? `${items.slice(0, -1).join(", ")} & ${items.at(-1)}` : items[0];
    } else {
      const w = spec.split(" ");
      w.pop();
      spec = w.join(" ").replace(/[\s,:&–-]+$/, "");
      if (/^(by|in|from|to|of|for|the|a|an|on|at|via)$/i.test(w.at(-1) ?? "")) spec = w.slice(0, -1).join(" ");
    }
  }
  let title = build(spec);
  if (title.length > SEO_TITLE_MAX) title = `${kwTitle}${suffix}`;
  outline.title = title;
  if (title.length <= SEO_TITLE_MAX) outline.seoTitle = title;

  // Meta description: strip banned words, trim to <= 155 at a sentence or word boundary.
  let d = String(outline.seoDescription ?? "").replace(/\s+/g, " ").trim();
  // Words inside the search phrase itself ("harbin tour guide") stay; other banned words go.
  const kwAny = primary ? new RegExp(escRe(primary).replace(/\s+/g, "[\\s-]+") + "s?", "gi") : null;
  const keep = [];
  if (kwAny) d = d.replace(kwAny, (m) => `\u0000${keep.push(m) - 1}\u0000`);
  d = d.replace(new RegExp(BANNED_DESC_RE.source, "gi"), (m) => (/^guides?$/i.test(m) ? "plan" : "")).replace(/\s{2,}/g, " ").trim();
  d = d.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
  if (d.length > 155) {
    const sentences = d.match(/[^.!?]+[.!?]+/g) ?? [d];
    let acc = "";
    for (const s of sentences) {
      if ((acc + s).trim().length <= 155) acc += s;
      else break;
    }
    acc = acc.trim();
    if (acc.length >= 120 && (!primary || hasKeyword(acc, primary))) d = acc;
    else {
      let cut = d.slice(0, 154);
      cut = cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:&–-]+$/, "");
      d = `${cut}.`;
    }
  }
  if (primary && !hasKeyword(d, primary)) {
    const lead = `${kwTitle}: `;
    let body = d;
    while ((lead + body).length > 155 && body.includes(" ")) body = body.slice(0, body.lastIndexOf(" "));
    d = `${lead}${body.replace(/[\s,;:&–-]+$/, "")}${/[.!?]$/.test(body) ? "" : "."}`;
  }
  for (const c of [" See the day-by-day plan.", " Plan your route."]) if (d.length < 140 && (d + c).length <= 155) { d += c; break; }
  outline.seoDescription = d;
  return outline;
}
