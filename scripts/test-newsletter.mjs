#!/usr/bin/env node
/** Offline checks for the weekly newsletter: weeks, rotation, rendering, brand rules, unsubscribe token. */
import assert from "node:assert/strict";
import { loadCatalog, loadPosts } from "./lib/blog-core.mjs";
import { LOCALES, buildEmail, emailProblems, isFeaturable, isoWeek, livePosts, pickFeatured, unsubscribeToken } from "./lib/newsletter-core.mjs";

assert.equal(isoWeek(new Date("2026-10-31T12:00:00Z")), "2026-W44");
assert.equal(isoWeek(new Date("2026-11-05T05:00:00Z")), "2026-W45");
assert.equal(isoWeek(new Date("2027-01-01T05:00:00Z")), "2026-W53");
assert.equal(isoWeek(new Date("2027-01-04T05:00:00Z")), "2027-W01");

const pkgs = [...loadCatalog().packages.values()];
const posts = livePosts(loadPosts().map((x) => x.post));
const pool = pkgs.filter(isFeaturable);
assert.ok(pool.length >= 5, "enough featurable packages");

// Rotation: every package once before any repeat; same week => same pick.
let state = { version: 1, weeks: {}, cycleUsed: [], cycle: 1 };
const seen = [];
let t = new Date("2026-11-05T05:00:00Z").getTime();
for (let i = 0; i < pool.length; i++, t += 7 * 86400000) {
  const now = new Date(t);
  const week = isoWeek(now);
  const r1 = pickFeatured(pkgs, posts, state, week, now);
  const r2 = pickFeatured(pkgs, posts, r1.state, week, now);
  assert.equal(r1.slug, r2.slug, "same week, same tour");
  assert.ok(r2.reused);
  assert.ok(!seen.includes(r1.slug), `no repeat before cycle end (${r1.slug})`);
  seen.push(r1.slug);
  state = r1.state;
}
assert.equal(seen.length, pool.length);
const wrap = pickFeatured(pkgs, posts, state, isoWeek(new Date(t)), new Date(t));
assert.equal(wrap.state.cycle, 2, "new cycle after all were used");

// Prefers a destination blogged this week.
const recentDest = posts[0].destination;
const fresh = pickFeatured(pkgs, posts, { weeks: {}, cycleUsed: [] }, isoWeek(new Date(posts[0].publishedAt)), new Date(posts[0].publishedAt));
assert.equal(pkgs.find((p) => p.slug === fresh.slug).destination, recentDest);

// Rendering + brand rules in every locale, for every package.
for (const pkg of pool) {
  for (const locale of LOCALES) {
    const e = buildEmail({ locale, pkg, posts: posts.slice(0, 3), week: "2026-W45", unsubscribeUrl: "https://sundayatlastravel.com/api/unsubscribe?id=x&t=y&l=en" });
    assert.deepEqual(emailProblems(e), [], `${pkg.slug}/${locale}`);
    assert.ok(e.html.includes(`/${locale}/packages/${pkg.slug}/?utm_source=newsletter`), "package link with utm");
    assert.equal((e.html.match(/\/blog\/[a-z0-9-]+\/\?utm/g) || []).length >= 3, true, "3 blog links");
    assert.ok(e.text.includes("api/unsubscribe"), "text has unsubscribe");
  }
}

// Token matches the Pages Function implementation (Web Crypto, base64url, 32 chars).
const secret = "x".repeat(48);
const id = "subscribers." + "a".repeat(40);
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsub:${id}`))).toString("base64url").slice(0, 32);
assert.equal(unsubscribeToken(secret, id), sig);

console.log(`newsletter tests passed (${pool.length} packages x ${LOCALES.length} locales)`);
