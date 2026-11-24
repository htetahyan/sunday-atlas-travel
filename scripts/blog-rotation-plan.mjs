#!/usr/bin/env node
/**
 * Dry-run preview: one post/day, one destination per batch.
 * Actual execution also applies the aggregate Dubai-day allowance. No AI calls, no network, no writes.
 * Shows the queue/template topics; the real run puts researched keywords first
 * (scripts/lib/keyword-research.mjs).
 *   node scripts/blog-rotation-plan.mjs [--days=7] [--count=1] [--start=YYYY-MM-DD] [--json]
 */
import { QUEUE_FILE, loadCatalog, loadPosts, readJson } from "./lib/blog-core.mjs";
import { buildRotation, loadRotation, previewDays } from "./lib/blog-rotation.mjs";
import { bankTopics, loadKeywordStore } from "./lib/keyword-research.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const days = Number(args.days ?? 7);
const count = Math.min(1, Math.max(1, Number(args.count ?? 1)));
// Default start: the current slot (re-runs of a finished slot show as "done").
const start = args.start ? new Date(`${args.start}T02:17:00Z`) : new Date();
const catalog = loadCatalog();
const posts = loadPosts();
const queue = readJson(QUEUE_FILE);
const state = loadRotation();
const store = loadKeywordStore();
const bank = (slug, simPosts) => bankTopics(store, slug, { catalog, posts: simPosts, count }).topics;
const plan = previewDays(catalog, queue, posts, state, { days, count, startDate: start, bank });

if (args.json) {
  console.log(JSON.stringify(plan.map((d) => ({ date: d.date, slot: d.slot, done: Boolean(d.done), destination: d.destination, skipped: d.skipped, topics: d.topics.slice(0, count).map((t) => ({ id: t.id, keyword: t.keyword, category: t.category, source: t.source ?? "queue", packages: t.packages })) })), null, 2));
} else {
  console.log("Rotation (fewest posts first):");
  for (const r of buildRotation(catalog, posts)) console.log(`  ${r.slug.padEnd(13)} posts=${r.posts} ownPackages=${r.ownPackages} packages=${r.packages}`);
  console.log(`State: cycle=[${(state.cycle ?? []).join(", ")}] last=${state.history?.at(-1)?.destination ?? "none"}\n`);
  for (const d of plan) {
    const when = `${d.date} ${["02:17"][d.slot] ?? "02:17"} UTC`;
    if (d.done) {
      console.log(`${when}  already done (${d.destination})`);
      continue;
    }
    console.log(`${when}  ${d.destination ? `${d.name} (/destinations/${d.destination}/)` : "NO DESTINATION"}${d.reset ? "  [new pass]" : ""}${d.sameSlot ? "  [top-up]" : ""}`);
    for (const s of d.skipped) console.log(`    skipped ${s.destination}: ${s.reason}`);
    for (const t of d.topics.slice(0, count)) console.log(`    - ${t.keyword}  [${t.category}; ${t.source ?? "queue"}]  packages: ${t.packages.join(", ")}`);
    if (d.topics.length > count) console.log(`    reserves if a post fails the gates: ${d.topics.slice(count).map((t) => t.keyword).join("; ")}`);
  }
}
