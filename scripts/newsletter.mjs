#!/usr/bin/env node
/**
 * Weekly newsletter for Sunday Atlas Travel subscribers (Sanity type "subscriber").
 * One featured tour (rotated, never repeated until all live packages were used), the 3 newest
 * travel blog posts, a sign-off from Jeremy, and a signed one-click unsubscribe link.
 *
 * Modes (default is --dry-run):
 *   node scripts/newsletter.mjs --dry-run [--out=dir]     render previews for all 5 locales; sends and writes nothing
 *   node scripts/newsletter.mjs --test-to=contact@sundayatlastravel.com [--locale=en]
 *                                                         send ONE test email to an @sundayatlastravel.com address
 *   node scripts/newsletter.mjs --send [--max=280]        real send; needs NEWSLETTER_ENABLED=true
 *   --week=2026-W45                                       override the ISO week (testing)
 *
 * Exactly one email per subscriber per ISO week:
 *   1. claim: patch lastAttemptWeek=<week> with ifRevisionID (a concurrent run loses the race);
 *   2. send through the Brevo transactional API;
 *   3. record lastSentWeek/lastSentAt/lastMessageId.
 *   Anyone with lastSentWeek or lastAttemptWeek = this week, or unsubscribed = true, is skipped.
 *   A definite API rejection releases the claim (retry later); a timeout keeps it (no double send).
 *
 * Env (names only, never print values):
 *   BREVO_API_KEY             Brevo > SMTP & API > API keys. Sender contact@sundayatlastravel.com is
 *                             verified and the domain is DKIM/DMARC-authenticated in Brevo.
 *   NEWSLETTER_UNSUB_SECRET   HMAC secret, same value as the Pages secret used by /api/unsubscribe.
 *   SANITY_API_WRITE_TOKEN    reads subscribers and records sends.
 *   NEWSLETTER_ENABLED        must be "true" for --send.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_DIR, ROOT, loadCatalog, loadPosts, readJson, writeJson } from "./lib/blog-core.mjs";
import {
  LOCALES,
  SENDER,
  buildEmail,
  emailProblems,
  isoWeek,
  livePosts,
  pickFeatured,
  unsubscribeUrl,
} from "./lib/newsletter-core.mjs";

const STATE_FILE = join(CONTENT_DIR, "newsletter-state.json");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const mode = args.send ? "send" : args["test-to"] ? "test" : "dry-run";
const now = new Date();
const week = typeof args.week === "string" && /^\d{4}-W\d{2}$/.test(args.week) ? args.week : isoWeek(now);
const projectId = process.env.SANITY_PROJECT_ID || "mi09tcmc";
const dataset = process.env.SANITY_DATASET || "production";
const sanityToken = process.env.SANITY_API_WRITE_TOKEN || "";
const brevoKey = process.env.BREVO_API_KEY || "";
const unsubSecret = process.env.NEWSLETTER_UNSUB_SECRET || "";
const report = { mode, week, featured: null, subjects: {}, sent: 0, skipped: {}, failed: 0, problems: [] };

function fail(message, code = 1) {
  console.error(`newsletter: ${message}`);
  report.error = message;
  writeFileSync(join(ROOT, "newsletter-report.json"), JSON.stringify(report, null, 2));
  process.exit(code);
}

/* ------------------------------------------------------------------ content */

const { packages } = loadCatalog();
const posts = livePosts(loadPosts().map((x) => x.post));
if (posts.length < 3) fail("fewer than 3 live blog posts");
const state = existsSync(STATE_FILE) ? readJson(STATE_FILE) : { version: 1, weeks: {}, cycleUsed: [], cycle: 1 };
const { slug, state: nextState, reused } = pickFeatured([...packages.values()], posts, state, week, now);
const pkg = packages.get(slug);
report.featured = { slug, destination: pkg.destination, priceFrom: pkg.priceFrom, durationDays: pkg.durationDays, reused };
const latest = posts.slice(0, 3);
report.posts = latest.map((p) => p.slug);

const emails = {};
for (const locale of LOCALES) {
  const preview = buildEmail({ locale, pkg, posts: latest, week, unsubscribeUrl: `https://sundayatlastravel.com/api/unsubscribe?id=preview&t=preview&l=${locale}` });
  const problems = emailProblems(preview);
  if (problems.length) report.problems.push(...problems.map((p) => `${locale} ${p}`));
  emails[locale] = preview;
  report.subjects[locale] = preview.subject;
}
if (report.problems.length) fail(`brand checks failed: ${report.problems.join("; ")}`, 3);

/* ------------------------------------------------------------------ io helpers */

async function sanityQuery(query) {
  const url = `https://${projectId}.api.sanity.io/v2023-10-01/data/query/${dataset}?query=${encodeURIComponent(query)}&perspective=raw`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${sanityToken}` } });
  if (!r.ok) throw new Error(`Sanity query HTTP ${r.status}`);
  return (await r.json()).result;
}

async function sanityMutate(mutations) {
  const url = `https://${projectId}.api.sanity.io/v2023-10-01/data/mutate/${dataset}?returnIds=true&visibility=sync`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sanityToken}` },
    body: JSON.stringify({ mutations }),
  });
  return r;
}

async function brevoSend({ to, email, unsubUrl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json", "api-key": brevoKey },
      body: JSON.stringify({
        sender: SENDER,
        to: [{ email: to }],
        replyTo: { email: SENDER.email, name: "Jeremy" },
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>, <mailto:${SENDER.email}?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: ["newsletter", `weekly-${week.toLowerCase()}`],
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, messageId: body.messageId || "" };
    return { ok: false, definite: true, status: r.status, message: String(body.message || body.code || "").slice(0, 200) };
  } catch (e) {
    return { ok: false, definite: false, status: 0, message: e.name === "AbortError" ? "timeout" : String(e.message).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ modes */

if (mode === "dry-run") {
  const out = typeof args.out === "string" ? args.out : join(ROOT, "newsletter-preview");
  mkdirSync(out, { recursive: true });
  for (const locale of LOCALES) {
    writeFileSync(join(out, `newsletter-${week}-${locale}.html`), emails[locale].html);
    writeFileSync(join(out, `newsletter-${week}-${locale}.txt`), `Subject: ${emails[locale].subject}\n\n${emails[locale].text}\n`);
  }
  if (sanityToken) {
    try {
      const subs = await sanityQuery('*[_type == "subscriber" && defined(email)]{locale, unsubscribed, lastSentWeek, lastAttemptWeek}');
      const due = subs.filter((s) => s.unsubscribed !== true && s.lastSentWeek !== week && s.lastAttemptWeek !== week);
      report.subscribers = { total: subs.length, due: due.length, unsubscribed: subs.filter((s) => s.unsubscribed === true).length };
    } catch (e) {
      report.subscribers = { error: e.message };
    }
  }
  report.out = out;
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(join(ROOT, "newsletter-report.json"), JSON.stringify(report, null, 2));
  process.exit(0);
}

if (!brevoKey) fail("BREVO_API_KEY is not set", 2);

if (mode === "test") {
  const to = String(args["test-to"]).trim().toLowerCase();
  if (!/^[^@\s]+@sundayatlastravel\.com$/.test(to)) fail("--test-to must be an @sundayatlastravel.com address");
  const locale = LOCALES.includes(args.locale) ? args.locale : "en";
  const unsubUrl = `https://sundayatlastravel.com/api/unsubscribe?id=test&t=test&l=${locale}`;
  const email = buildEmail({ locale, pkg, posts: latest, week, unsubscribeUrl: unsubUrl });
  const result = await brevoSend({ to, email: { ...email, subject: `[TEST] ${email.subject}` }, unsubUrl });
  report.test = { to, locale, ...result };
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(join(ROOT, "newsletter-report.json"), JSON.stringify(report, null, 2));
  process.exit(result.ok ? 0 : 1);
}

// mode === "send"
if (process.env.NEWSLETTER_ENABLED !== "true") fail("NEWSLETTER_ENABLED is not \"true\"; refusing to send", 5);
if (!unsubSecret || unsubSecret.length < 32) fail("NEWSLETTER_UNSUB_SECRET is missing or too short", 2);
if (!sanityToken) fail("SANITY_API_WRITE_TOKEN is not set", 2);

// Fix the featured tour for this week before any send, so a re-run uses the same one.
writeJson(STATE_FILE, nextState);

const max = Number.parseInt(args.max, 10) > 0 ? Number.parseInt(args.max, 10) : 280; // Brevo free: 300/day
const subs = await sanityQuery(
  '*[_type == "subscriber" && defined(email)] | order(createdAt asc) {_id, _rev, email, locale, unsubscribed, lastSentWeek, lastAttemptWeek}',
);
const skip = (why) => (report.skipped[why] = (report.skipped[why] || 0) + 1);
for (const s of subs) {
  if (s.unsubscribed === true) { skip("unsubscribed"); continue; }
  if (s.lastSentWeek === week) { skip("already_sent"); continue; }
  if (s.lastAttemptWeek === week) { skip("attempt_pending"); continue; }
  if (!/^subscribers\.[0-9a-f]{40}$/.test(s._id)) { skip("bad_id"); continue; }
  if (report.sent >= max) { skip("over_daily_cap"); continue; }

  const claim = await sanityMutate([{ patch: { id: s._id, ifRevisionID: s._rev, set: { lastAttemptWeek: week, lastAttemptAt: new Date().toISOString() } } }]);
  if (!claim.ok) { skip(claim.status === 409 ? "claimed_elsewhere" : "claim_failed"); continue; }

  const locale = LOCALES.includes(s.locale) ? s.locale : "en";
  const unsubUrl = unsubscribeUrl(unsubSecret, s._id, locale);
  const email = buildEmail({ locale, pkg, posts: latest, week, unsubscribeUrl: unsubUrl });
  const result = await brevoSend({ to: s.email, email, unsubUrl });
  if (result.ok) {
    report.sent += 1;
    await sanityMutate([{ patch: { id: s._id, set: { lastSentWeek: week, lastSentAt: new Date().toISOString(), lastMessageId: result.messageId } } }]);
  } else {
    report.failed += 1;
    console.warn(`send failed (${result.status}): ${result.message}`);
    if (result.definite) await sanityMutate([{ patch: { id: s._id, unset: ["lastAttemptWeek", "lastAttemptAt"] } }]);
  }
  await sleep(250);
}
console.log(JSON.stringify(report, null, 2));
writeFileSync(join(ROOT, "newsletter-report.json"), JSON.stringify(report, null, 2));
process.exit(report.failed && !report.sent ? 1 : 0);
