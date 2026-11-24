/**
 * One destination per day for the daily blog job.
 *
 * Every run picks ONE destination and writes all of the day's posts about it; the next
 * run moves on to a different destination. State lives in content/blog-rotation.json
 * (committed by the workflow) so the choice is deterministic and reviewable:
 *
 *   { version, cycle: [slugs used in the current pass], history: [{ date, destination, topics, created }] }
 *
 * Order inside a pass: destinations with live tour packages only, fewest existing posts
 * first, then more live packages, then slug. A destination already used in the current
 * pass is not picked again until every eligible destination has had a day. A destination
 * that cannot give COUNT non-duplicate topics is skipped for the day.
 * A destination that is planned but yields 0 published posts is blocked for that UTC date
 * (state.blockedDestinations) so the same run — and later runs that day — move on to the
 * next destination instead of sticky-retrying. `same` (top up the slot's destination) only
 * applies when that slot already has created > 0.
 *
 * Topics come from pending entries in content/blog-topic-queue.json for that destination
 * (single-destination topics only), topped up with high-search-volume templates
 * (things to do, top places, best time, travel guide, itinerary, costs). Each topic is
 * linked to the destination's live packages; the post page links to the destination hub
 * through post.destination.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findDuplicateTopic, isLinkablePackage, readJson, slugify, writeJson } from "./blog-core.mjs";
import { linkablePackagesFor } from "./keyword-research.mjs";

export const ROTATION_FILE = join(process.cwd(), "content", "blog-rotation.json");
const DUP_THRESHOLD = 0.6; // same rule as blog-daily.mjs

export function loadRotation(file = ROTATION_FILE) {
  if (!existsSync(file)) return { version: 1, cycle: [], history: [] };
  const s = readJson(file);
  return { version: 1, cycle: [], history: [], ...s };
}

export function saveRotation(state, file = ROTATION_FILE) {
  state.history = (state.history ?? []).slice(-60);
  // Keep about a week of per-day blocks so a failed destination is not retried all day.
  if (state.blockedDestinations) {
    const dates = Object.keys(state.blockedDestinations).sort();
    while (dates.length > 7) delete state.blockedDestinations[dates.shift()];
  }
  writeJson(file, state);
}

/** Destinations blocked for a UTC date after a 0-post attempt (do not count as a filled slot). */
export function blockedSlugs(state, date) {
  return new Set(
    (state?.blockedDestinations?.[date] ?? []).map((x) => (typeof x === "string" ? x : x.destination)),
  );
}

/** Record that a destination produced 0 posts for `date` so planRun skips it. */
export function recordBlocked(state, date, destination, reason = "0 posts") {
  if (!state || !date || !destination) return state;
  const map = { ...(state.blockedDestinations ?? {}) };
  const list = [...(map[date] ?? [])];
  if (!list.some((x) => (typeof x === "string" ? x : x.destination) === destination)) {
    list.push({ destination, reason, at: new Date().toISOString() });
  }
  map[date] = list;
  state.blockedDestinations = map;
  return state;
}

/**
 * Topic ids the generator must not retry: queue status `skipped`, or attempts already high.
 * Bank/template merges re-create objects with status "pending", so callers filter by id.
 */
export function skippedTopicIds(queue) {
  const ids = new Set();
  for (const t of queue?.topics ?? []) {
    if (t.status === "skipped" || (t.attempts ?? 0) >= 2) {
      if (t.id) ids.add(t.id);
      if (t.keyword) ids.add(slugify(t.keyword));
      if (t.slug) ids.add(slugify(t.slug));
    }
  }
  return ids;
}

/** Drop researched/bank/template topics that match a skipped (or high-attempt) queue entry. */
export function filterLiveTopics(topics, queue) {
  const bad = skippedTopicIds(queue);
  if (!bad.size) return topics;
  return (topics ?? []).filter((t) => {
    const id = t.id || slugify(t.slug || t.keyword || "");
    const kw = t.keyword ? slugify(t.keyword) : "";
    return !bad.has(id) && (!kw || !bad.has(kw));
  });
}

/** Linkable packages for a destination (priced or price on request): its own first (cheapest first), then multi-country ones that visit it. */
export function destinationPackages(catalog, slug) {
  return linkablePackagesFor(catalog, slug);
}

/** Rotation list: published destination pages with at least one own live package and 2+ live packages overall. */
export function buildRotation(catalog, posts) {
  const out = [];
  for (const [slug, dest] of catalog.destinations) {
    if (dest.published === false) continue;
    const pk = destinationPackages(catalog, slug);
    if (pk.own.length < 1 || pk.all.length < 2) continue;
    const postCount = posts.filter((e) => e.post.destination === slug).length;
    out.push({ slug, name: dest.name?.en ?? slug, ownPackages: pk.own.length, packages: pk.all.length, posts: postCount });
  }
  out.sort((a, b) => a.posts - b.posts || b.ownPackages - a.ownPackages || b.packages - a.packages || a.slug.localeCompare(b.slug));
  return out;
}

const KINDS = [
  { kind: "things-to-do", re: /^things to do\b/i, score: 100, category: "top-places" },
  { kind: "top-places", re: /^top \d+ places|places to visit/i, score: 95, category: "top-places" },
  { kind: "best-time", re: /^best time to (visit|go)/i, score: 90, category: "seasonal" },
  { kind: "itinerary", re: /itinerary/i, score: 85, category: "destination-guide" },
  { kind: "day-trips", re: /^day trips? from/i, score: 80, category: "day-trips" },
  { kind: "travel-guide", re: /travel guide$/i, score: 75, category: "destination-guide" },
  { kind: "costs", re: /cost|budget|price/i, score: 70, category: "destination-guide" },
  { kind: "day-trip", re: /day trip|hike|hiking/i, score: 65, category: "day-trips" },
];
export function topicKind(keyword) {
  return KINDS.find((k) => k.re.test(keyword)) ?? { kind: "other", score: 60, category: "destination-guide" };
}

const MULTI_RE = /central asia|\bstans\b|silk road/i;

/** Same slug, near-identical title, or the same search intent for the same place (see findDuplicateTopic). */
function isDuplicate(slug, keyword, posts, destination = "") {
  return findDuplicateTopic({ slug, title: keyword, destination }, posts, DUP_THRESHOLD)?.post;
}

function templateTopics(dest, pk) {
  const X = dest.name?.en ?? dest.slug;
  const days = pk.own.map((p) => p.durationDays).filter((d) => d >= 3).sort((a, b) => a - b)[0] ?? 7;
  const t = (keyword, angle) => ({ keyword, angle, generated: true });
  return [
    t(`things to do in ${X}`, `The best things to do across ${X}, grouped by city and region, with our ${X} tours`),
    t(`top 10 places to visit in ${X}`, `A ranked list of the ten places in ${X} worth the trip, with how to reach each one`),
    t(`best time to visit ${X}`, `Month-by-month weather, crowds and festivals in ${X}, and which tour fits each season`),
    t(`${X} itinerary ${days} days`, `A day-by-day ${days}-day route through ${X} based on our packages`),
    t(`${X} travel guide`, `First-timer guide to ${X}: getting in, getting around, money, food and where to go`),
    t(`${X} travel costs and budget`, `What a trip to ${X} costs: tours from our catalog, meals, transport and tips`),
  ];
}

/** Candidate topics for one destination, best first. Does not mutate the queue. */
export function candidateTopics(slug, catalog, queue, posts, { count = 3 } = {}) {
  return candidateTopicsBase(slug, catalog, queue, posts, { count });
}

function candidateTopicsBase(slug, catalog, queue, posts, { count = 3 } = {}) {
  const dest = catalog.destinations.get(slug);
  if (!dest) return [];
  const pk = destinationPackages(catalog, slug);
  const otherNames = [...catalog.destinations.values()]
    .filter((d) => d.slug !== slug)
    .map((d) => (d.name?.en ?? d.slug).toLowerCase());
  const linkPackages = (pkgs) => {
    const liveListed = (pkgs ?? []).filter((s) => isLinkablePackage(catalog.packages.get(s)));
    const merged = [...new Set([...liveListed, ...pk.all.map((p) => p.slug)])];
    return merged.slice(0, Math.max(4, liveListed.length));
  };
  const fromQueue = queue.topics
    .filter((t) => t.status === "pending" && t.destination === slug)
    .filter((t) => (t.countries ?? []).length < 2 && !MULTI_RE.test(t.keyword))
    .filter((t) => !otherNames.some((n) => t.keyword.toLowerCase().includes(n)))
    .map((t) => ({ ...t, packages: linkPackages(t.packages), fromQueue: true }));
  const queued = new Set(queue.topics.map((t) => t.id));
  const fromTemplates = templateTopics(dest, pk).map((t) => {
    const id = slugify(t.keyword);
    return {
      id,
      keyword: t.keyword,
      destination: slug,
      countries: [],
      category: topicKind(t.keyword).category,
      packages: pk.all.slice(0, 4).map((p) => p.slug),
      angle: t.angle,
      status: "pending",
      source: "rotation",
      fromQueue: false,
      _queued: queued.has(id),
    };
  }).filter((t) => !t._queued); // a queue entry with this id already exists (any status)

  const all = [...fromQueue, ...fromTemplates]
    .map((t) => ({ ...t, ...{ kind: topicKind(t.keyword).kind, score: topicKind(t.keyword).score + (t.fromQueue ? 1 : 0) } }))
    .filter((t) => t.packages.filter((s) => isLinkablePackage(catalog.packages.get(s))).length >= 2)
    .filter((t) => !isDuplicate(slugify(t.slug || t.id || t.keyword), t.keyword, posts, slug));
  all.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));

  // Greedy, curated queue topics before templates: one topic per kind first (variety), then
  // fill; never two near-duplicates in one day.
  const picked = [];
  const clash = (t) =>
    Boolean(
      findDuplicateTopic(
        { slug: slugify(t.id), title: t.keyword },
        picked.map((p) => ({ post: { slug: slugify(p.id), title: { en: p.keyword } } })),
        DUP_THRESHOLD,
      ),
    );
  const passes = [
    (t) => t.fromQueue && !picked.some((p) => p.kind === t.kind),
    (t) => !t.fromQueue && !picked.some((p) => p.kind === t.kind),
    (t) => t.fromQueue,
    () => true,
  ];
  for (const ok of passes) {
    for (const t of all) {
      if (picked.includes(t) || !ok(t) || clash(t)) continue;
      picked.push(t);
    }
  }
  return picked; // ordered; the first `count` are the plan, the rest are same-destination reserves
}

/**
 * One scheduled run a day at UTC 02:17 (06:17 Asia/Dubai). Hourly catch-up may retry that
 * same slot after it has started, but never opens a second slot or a previous-day backlog.
 */
export const SLOT_HOURS_UTC = [2];
export const SLOT_MINUTE = 17;

/** The most recent slot start at or before `now`: { date: "YYYY-MM-DD" (UTC), slot: 0 }. */
export function currentSlot(now = new Date()) {
  for (let back = 0; back < 2; back += 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    for (let i = SLOT_HOURS_UTC.length - 1; i >= 0; i -= 1) {
      const start = new Date(day.getTime() + (SLOT_HOURS_UTC[i] * 60 + SLOT_MINUTE) * 60000);
      if (start <= now) return { date: day.toISOString().slice(0, 10), slot: i };
    }
  }
  return { date: now.toISOString().slice(0, 10), slot: 0 };
}

/** History entries before slots existed count as slot 0 of their day. */
const slotOf = (h) => (typeof h.slot === "number" ? h.slot : 0);

/**
 * Only today's single UTC slot (02:17 = 06:17 Asia/Dubai). A late or dropped scheduled run
 * may be retried by the hourly catch-up after that start time. Missed earlier days stay missed:
 * never fill a backlog in addition to today's post. Before today's slot starts, the run is done.
 */
export function pickSlot(state, now = new Date(), count = 1) {
  const filled = (date, slot) => (slotEntry(state, date, slot)?.created ?? 0) >= count;
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  const started = Date.parse(`${date}T00:00:00Z`) + (SLOT_HOURS_UTC[0] * 60 + SLOT_MINUTE) * 60000 <= now.getTime();
  if (!started) return { date, slot: 0, done: true, catchUp: false };
  const done = filled(date, 0);
  return { date, slot: 0, done, catchUp: false };
}

/** The history entry for one slot, if that slot already ran. */
export function slotEntry(state, date, slot) {
  return (state.history ?? []).find((h) => h.date === date && slotOf(h) === slot);
}

/** Destination order for one run, before topics are checked. Pure. */
function runOrder(catalog, posts, state, { date, slot }) {
  const rotation = buildRotation(catalog, posts);
  const eligible = rotation.map((r) => r.slug);
  const blocked = blockedSlugs(state, date);
  const last = state.history?.at(-1)?.destination;
  const usedToday = new Set((state.history ?? []).filter((h) => h.date === date && slotOf(h) !== slot).map((h) => h.destination));
  let cycle = (state.cycle ?? []).filter((s) => eligible.includes(s));
  let order = rotation.filter((r) => !cycle.includes(r.slug) && !usedToday.has(r.slug) && !blocked.has(r.slug));
  let reset = false;
  if (order.length === 0) {
    reset = true;
    cycle = [];
    order = rotation.filter((r) => r.slug !== last && !usedToday.has(r.slug) && !blocked.has(r.slug));
  }
  const entry = slotEntry(state, date, slot);
  // Top up the same destination only when this slot already published at least one post.
  // Never sticky-retry a destination after a 0-post failure (those go in blockedDestinations).
  const same =
    entry &&
    (entry.created ?? 0) > 0 &&
    eligible.includes(entry.destination) &&
    !blocked.has(entry.destination)
      ? rotation.find((x) => x.slug === entry.destination)
      : null;
  // A nonempty remainder can still be exhausted after keyword/duplicate filtering.
  // Only after trying it, allow viable destinations from the next pass (not today's
  // destinations, the last destination, or explicit failed-destination blocks).
  const fallbackOrder = reset ? [] : rotation.filter(r =>
    !order.some(x => x.slug === r.slug) && r.slug !== last &&
    !usedToday.has(r.slug) && !blocked.has(r.slug));
  return { rotation, order, fallbackOrder, reset, cycle, entry, same, blocked };
}

/** Merge researched topics (first) with queue/template topics (reserves), no near-duplicates. */
export function mergeTopics(researched, fallback) {
  const out = [...researched];
  for (const t of fallback) {
    const clash = findDuplicateTopic(
      { slug: slugify(t.slug || t.id || t.keyword), title: t.keyword },
      out.map((p) => ({ post: { slug: slugify(p.slug || p.id || p.keyword), title: { en: p.keyword } } })),
      DUP_THRESHOLD,
    );
    if (!clash) out.push(t);
  }
  return out;
}

/**
 * Pick this run's destination and topics. `research(slug)` (optional, async) returns researched
 * topics for a destination; they go first, queue/template topics are reserves and the fallback
 * when research finds nothing. Returns { done: true } when this slot already has `count` posts.
 */
export async function planRun(catalog, queue, posts, state, { count = 3, date, slot = 0, research } = {}) {
  const { rotation, order, fallbackOrder, reset, cycle, entry, same } = runOrder(catalog, posts, state, { date, slot });
  const skipped = [];
  const base = { date, slot, rotation, skipped };
  const topicsFor = async (slug) => {
    const fallback = candidateTopics(slug, catalog, queue, posts, { count });
    let researched = [];
    let researchStats = null;
    if (research) {
      const r = await research(slug);
      researched = r?.topics ?? [];
      researchStats = r?.stats ?? null;
    }
    // Drop bank/researched ids that the queue already marked skipped (or attempts >= 2).
    const topics = filterLiveTopics(mergeTopics(researched, fallback), queue);
    return { topics, researched: researched.length, researchStats };
  };
  if (entry && (entry.created ?? 0) >= count)
    return { ...base, done: true, destination: entry.destination, topics: [], reset: false, cycle: state.cycle ?? [] };
  if (same) {
    const t = await topicsFor(same.slug);
    if (t.topics.length > 0)
      return { ...base, ...t, destination: same.slug, name: same.name, reset: false, sameSlot: true, already: entry.created ?? 0, cycle: (state.cycle ?? []).filter((x) => x !== same.slug) };
  }
  for (const r of [...order, ...fallbackOrder.map(r => ({ ...r, nextPass: true }))]) {
    const t = await topicsFor(r.slug);
    if (t.topics.length < count) {
      skipped.push({ destination: r.slug, reason: `only ${t.topics.length} non-duplicate topic(s)` });
      continue;
    }
    return { ...base, ...t, destination: r.slug, name: r.name, reset: Boolean(r.nextPass) || reset, cycle: r.nextPass ? [] : cycle };
  }
  return { ...base, destination: null, topics: [], reset, cycle };
}

/** Synchronous plan without keyword research (previews and tests). */
export function planDay(catalog, queue, posts, state, { count = 3, date, slot = 0, bank } = {}) {
  const { rotation, order, fallbackOrder, reset, cycle, entry, same } = runOrder(catalog, posts, state, { date, slot });
  const skipped = [];
  // bank(slug) (optional, sync): keyword-bank topics first, queue/template topics as reserves.
  const topicsFor = (slug, ...rest) =>
    filterLiveTopics(mergeTopics(bank ? bank(slug) : [], candidateTopicsBase(slug, ...rest)), queue);
  if (entry && (entry.created ?? 0) >= count)
    return { date, slot, done: true, destination: entry.destination, topics: [], reset: false, skipped, cycle: state.cycle ?? [], rotation };
  if (same) {
    const topics = topicsFor(same.slug, catalog, queue, posts, { count });
    if (topics.length > 0)
      return { date, slot, destination: same.slug, name: same.name, topics, reset: false, sameSlot: true, skipped, cycle: (state.cycle ?? []).filter((x) => x !== same.slug), rotation };
  }
  for (const r of [...order, ...fallbackOrder.map(r => ({ ...r, nextPass: true }))]) {
    const topics = topicsFor(r.slug, catalog, queue, posts, { count });
    if (topics.length < count) {
      skipped.push({ destination: r.slug, reason: `only ${topics.length} non-duplicate topic(s)` });
      continue;
    }
    return { date, slot, destination: r.slug, name: r.name, topics, reset: Boolean(r.nextPass) || reset, skipped, cycle: r.nextPass ? [] : cycle, rotation };
  }
  return { date, slot, destination: null, topics: [], reset, skipped, cycle, rotation };
}

/** Record a finished run in the state (call only for real runs). */
export function recordDay(state, plan, createdIds) {
  if (!plan.destination || plan.done) return state;
  // A run that wrote nothing does not use up the destination for this pass or claim the slot.
  if (!createdIds.length && !(state.history ?? []).some((h) => h.date === plan.date && slotOf(h) === (plan.slot ?? 0))) return state;
  state.cycle = [...(plan.reset ? [] : plan.cycle), plan.destination];
  const history = [...(state.history ?? [])];
  const entry = history.find((h) => h.date === plan.date && slotOf(h) === (plan.slot ?? 0));
  if (entry && entry.destination === plan.destination) {
    entry.topics = [...new Set([...(entry.topics ?? []), ...createdIds])];
    entry.created = entry.topics.length;
    entry.slot = plan.slot ?? 0;
  } else {
    history.push({ date: plan.date, slot: plan.slot ?? 0, destination: plan.destination, topics: createdIds, created: createdIds.length });
  }
  state.history = history;
  return state;
}

/** Turn a planned topic into the queue entry the generator updates (adds template topics to the queue). */
export function materializeTopic(queue, t) {
  const existing = queue.topics.find((x) => x.id === t.id);
  if (existing) {
    existing.packages = t.packages; // destination's live packages, so every post links to them
    for (const k of ["secondary", "questions", "research"]) if (t[k]) existing[k] = t[k];
    return existing;
  }
  const entry = {
    id: t.id,
    keyword: t.keyword,
    destination: t.destination,
    countries: [],
    category: t.category,
    packages: t.packages,
    angle: t.angle,
    status: "pending",
    source: t.source ?? "rotation",
    ...(t.secondary ? { secondary: t.secondary } : {}),
    ...(t.questions ? { questions: t.questions } : {}),
    ...(t.research ? { research: t.research } : {}),
  };
  queue.topics.push(entry);
  return entry;
}

/** Simulate N days x runsPerDay runs without AI calls, network or writes: each run's first `count` topics count as published. */
export function previewDays(catalog, queue, posts, state, { days = 7, count = 1, runsPerDay = 1, startDate = new Date(), bank } = {}) {
  const q = structuredClone(queue);
  const p = posts.map((e) => ({ post: { slug: e.post.slug, title: e.post.title, destination: e.post.destination } }));
  const s = structuredClone(state);
  const out = [];
  const first = currentSlot(startDate);
  let date = first.date;
  let slot = Math.min(first.slot, runsPerDay - 1);
  for (let i = 0; i < days * runsPerDay; i++) {
    const plan = planDay(catalog, q, p, s, { count, date, slot, bank: bank ? (slug) => bank(slug, p) : undefined });
    out.push(plan);
    if (plan.destination && !plan.done) {
      for (const t of plan.topics.slice(0, count)) {
        const slug = slugify(t.slug || t.id || t.keyword);
        const qt = q.topics.find((x) => x.id === t.id);
        if (qt) qt.status = "published";
        else q.topics.push({ ...t, status: "published" });
        p.push({ post: { slug, title: { en: t.keyword }, destination: plan.destination } });
      }
      recordDay(s, plan, plan.topics.slice(0, count).map((t) => t.id));
    }
    slot += 1;
    if (slot >= runsPerDay) {
      slot = 0;
      date = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    }
  }
  return out;
}
