#!/usr/bin/env node
/** Title repair + slot picking (3 Nov 2026 regressions). node scripts/test-blog-titles.mjs */
import assert from "node:assert/strict";
import { clickableTitleProblems, repairTitles } from "./lib/blog-titles.mjs";
import { pickSlot } from "./lib/blog-rotation.mjs";

const desc = (k) => `${k}: Ice and Snow World, Central Street, Snow Town and Changbai Mountain with train times, the best months and where to sleep each night, for first-time winter visitors. Plan your route.`;
const cases = [
  ["harbin itinerary 7 days", "Harbin Itinerary 7 Days: Harbin, Snow Town, Changbai Mountain & Yanji by Train (2027)"],
  ["things to do in jilin", "Things to Do in Jilin: Rime Ice, Songhua Lake, Beidahu Skiing and Yanji Guide 2027"],
  ["best time to visit harbin", "Best Time to Visit Harbin: Ice Festival Months, Snow Town Season and Summer Weather (2027)"],
  ["is harbin worth visiting", "Is Harbin Worth Visiting? Ice Festival, Russian Architecture & Snow Town Day Trips (2027)"],
  ["harbin tour guide", "Harbin Tour Guide: Ice and Snow World, Central Street, Sun Island and Siberian Tigers (2026)"],
  ["tajikistan itinerary 5 days", "5 Days in Tajikistan: Dushanbe, Iskanderkul and the Fann Mountains"],
];
for (const [k, t] of cases) {
  const o = { title: t, seoDescription: desc(k) };
  repairTitles(o, k, 2027);
  assert.deepEqual(clickableTitleProblems(o, k, 2027), [], `${k}: ${o.title} / ${o.seoDescription}`);
  assert.ok(o.title.endsWith("(2027)"));
  console.log(`ok ${o.title.length} ${o.title}`);
}

const st = { history: [{ date: "2026-11-02", slot: 0, created: 1 }] };
const early = pickSlot(st, new Date("2026-11-03T00:56:00Z")); // 04:56 Dubai; before 06:17 scheduled run
assert.equal(early.date, "2026-11-03");
assert.equal(early.slot, 0);
assert.equal(early.done, true, "do not generate before today's scheduled run or catch up yesterday");
assert.notEqual(early.date, "2026-11-02");
const late = pickSlot(st, new Date("2026-11-03T12:00:00Z")); // dropped 02:17, hourly catch-up fills today's single slot
assert.equal(late.date, "2026-11-03");
assert.equal(late.slot, 0);
assert.equal(late.done, false);
assert.equal(late.catchUp, false);
st.history.push({ date: "2026-11-03", slot: 0, created: 1 });
assert.equal(pickSlot(st, new Date("2026-11-03T12:00:00Z")).done, true);
assert.equal(pickSlot(st, new Date("2026-11-03T19:00:00Z")).done, true, "never a second slot in a day");
assert.equal(pickSlot(st, new Date("2026-11-02T20:23:00Z")).done, true, "late evening of a filled day stays done");
console.log("ok pickSlot");

// --- Destination failover / sticky-retry / wider catch-up (5 Nov 2026) ---
import {
  blockedSlugs,
  filterLiveTopics,
  planDay,
  recordBlocked,
} from "./lib/blog-rotation.mjs";

function miniCatalog() {
  const mkPkg = (slug, dest, price) => ({
    slug,
    published: true,
    priceFrom: price,
    durationDays: 5,
    destination: dest,
    countries: [dest],
  });
  const destinations = new Map();
  const packages = new Map();
  for (const [slug, name] of [
    ["turkmenistan", "Turkmenistan"],
    ["kazakhstan", "Kazakhstan"],
    ["uzbekistan", "Uzbekistan"],
  ]) {
    destinations.set(slug, { slug, name: { en: name }, published: true });
    const a = mkPkg(`${slug}-a`, slug, 400);
    const b = mkPkg(`${slug}-b`, slug, 800);
    packages.set(a.slug, a);
    packages.set(b.slug, b);
  }
  return { destinations, packages, allPrices: new Set([400, 800]) };
}

// linkablePackagesFor reads catalog.packages and destination membership — verify shape works.
{
  const state = { version: 1, cycle: [], history: [], blockedDestinations: {} };
  recordBlocked(state, "2026-11-05", "turkmenistan", "invented price 120");
  assert.ok(blockedSlugs(state, "2026-11-05").has("turkmenistan"));
  assert.equal(blockedSlugs(state, "2026-11-04").size, 0);

  const catalog = miniCatalog();
  const queue = { topics: [] };
  const posts = []; // fewest posts first → turkmenistan, kazakhstan, uzbekistan by slug order when posts equal
  // Force ordering: give uzbekistan many posts so turkmenistan/kazakhstan come first.
  for (let i = 0; i < 5; i++) posts.push({ post: { slug: `uz-${i}`, title: { en: `Uz ${i}` }, destination: "uzbekistan" } });

  const bank = (slug) => {
    const name = catalog.destinations.get(slug).name.en;
    const pkgs = [`${slug}-a`, `${slug}-b`];
    return [1, 2, 3].map((n) => ({
      id: `${slug}-topic-${n}`,
      keyword: `${name} itinerary ${n + 3} days`,
      destination: slug,
      category: "destination-guide",
      packages: pkgs,
      angle: `Route ${n}`,
      status: "pending",
      source: "keyword-bank",
    }));
  };

  const first = planDay(catalog, queue, posts, state, { count: 3, date: "2026-11-05", slot: 0, bank });
  // turkmenistan is blocked → must NOT be chosen
  assert.notEqual(first.destination, "turkmenistan", `blocked dest still planned: ${first.destination}`);
  assert.ok(first.destination === "kazakhstan" || first.destination === "uzbekistan", first.destination);
  console.log(`ok blocked failover → ${first.destination}`);
}

{
  // (b) `same` is ignored when created === 0 (history entry exists but published nothing).
  const catalog = miniCatalog();
  const queue = { topics: [] };
  const posts = [];
  for (let i = 0; i < 5; i++) posts.push({ post: { slug: `uz-${i}`, title: { en: `Uz ${i}` }, destination: "uzbekistan" } });
  const state = {
    version: 1,
    cycle: [],
    history: [{ date: "2026-11-05", slot: 0, destination: "turkmenistan", topics: [], created: 0 }],
    blockedDestinations: {},
  };
  const bank = (slug) => {
    const name = catalog.destinations.get(slug).name.en;
    return [1, 2, 3].map((n) => ({
      id: `${slug}-topic-${n}`,
      keyword: `${name} travel guide ${n}`,
      destination: slug,
      category: "destination-guide",
      packages: [`${slug}-a`, `${slug}-b`],
      angle: `Angle ${n}`,
      status: "pending",
      source: "keyword-bank",
    }));
  };
  const plan = planDay(catalog, queue, posts, state, { count: 3, date: "2026-11-05", slot: 0, bank });
  assert.notEqual(plan.destination, "turkmenistan", "same must not sticky-retry after created===0");
  assert.equal(Boolean(plan.sameSlot), false);
  console.log(`ok same ignored when created===0 → ${plan.destination}`);
}

{
  // Missed earlier days stay missed: never burst to fill a backlog, even before today's run.
  const st = {
    history: [
      { date: "2026-11-02", slot: 0, created: 1 },
      { date: "2026-11-04", slot: 0, created: 1 },
    ],
  };
  const before = pickSlot(st, new Date("2026-11-05T01:00:00Z"));
  assert.equal(before.date, "2026-11-05");
  assert.equal(before.slot, 0);
  assert.equal(before.done, true, "no previous-day catch-up before today's scheduled run");
  const after = pickSlot(st, new Date("2026-11-05T12:00:00Z"));
  assert.equal(after.date, "2026-11-05");
  assert.equal(after.slot, 0);
  assert.equal(after.done, false);
  console.log("ok pickSlot stays on today's single post, no backlog burst");
}

{
  // Skipped queue topics are excluded from merges.
  const queue = {
    topics: [
      { id: "turkmenistan-itinerary-7-days", keyword: "turkmenistan itinerary 7 days", status: "skipped", attempts: 14 },
      { id: "fresh-topic", keyword: "fresh topic", status: "pending", attempts: 0 },
    ],
  };
  const topics = [
    { id: "turkmenistan-itinerary-7-days", keyword: "turkmenistan itinerary 7 days" },
    { id: "brand-new-bank-kw", keyword: "darvaza gas crater tour" },
    { id: "fresh-topic", keyword: "fresh topic" },
  ];
  const live = filterLiveTopics(topics, queue);
  assert.deepEqual(
    live.map((t) => t.id),
    ["brand-new-bank-kw", "fresh-topic"],
  );
  console.log("ok filterLiveTopics drops skipped queue ids");
}

// Exhausted final destination must not block a new pass with eligible stored topics.
{
 const {candidateTopics,planRun}=await import('./lib/blog-rotation.mjs');
 const catalog=miniCatalog(),posts=[],queue={topics:[]};
 const exhausted=candidateTopics('turkmenistan',catalog,queue,posts,{count:3});
 queue.topics=exhausted.map(t=>({...t,status:'skipped',attempts:2}));
 const state={cycle:['kazakhstan','uzbekistan'],history:[{date:'2026-11-07',slot:0,destination:'uzbekistan',created:3}],blockedDestinations:{}};
 for(const plan of [planDay(catalog,queue,posts,state,{date:'2026-11-08',count:3}),await planRun(catalog,queue,posts,state,{date:'2026-11-08',count:3})]) {
  assert.equal(plan.destination,'kazakhstan','exhausted unvisited destination blocked viable next cycle');
  assert.equal(plan.reset,true);assert.ok(plan.topics.length>=3);
 }
 console.log('ok exhausted final destination falls through to viable next pass');
}
{
 const {previewDays}=await import('./lib/blog-rotation.mjs');
 const preview=previewDays(miniCatalog(),{topics:[]},[],{cycle:[],history:[]},{days:2,startDate:new Date('2026-11-08T11:00:00Z')});
 assert.equal(preview.length,2,'preview must show one 1-post batch/day, not three');
 assert.ok(preview.every(p=>p.topics.length===0||p.done||p.topics.length>=1));
 assert.deepEqual(preview.map(p=>p.slot),[0,0]);
 console.log('ok preview matches one post per day cadence');
}

{
 const catalog=miniCatalog(),queue={topics:[]},posts=[];
 const bank=(slug)=>slug==='kazakhstan'?[{
  id:'kazakhstan-one',keyword:'kazakhstan itinerary 5 days',destination:slug,
  category:'destination-guide',packages:[`${slug}-a`,`${slug}-b`],angle:'Route',status:'pending',source:'keyword-bank',
 }]:[];
 const plan=planDay(catalog,queue,posts,{cycle:[],history:[],blockedDestinations:{}},{count:1,date:'2026-11-11',slot:0,bank});
 assert.equal(plan.destination,'kazakhstan');
 assert.ok(plan.topics.length>=1);
 console.log('ok a single unused stored keyword is enough for the daily post');
}
