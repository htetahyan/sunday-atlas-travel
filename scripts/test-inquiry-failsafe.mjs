// Local test of functions/api/inquiry.ts. Turnstile siteverify and the mail Worker are
// mocked; D1 is emulated with node:sqlite running the real migrations/ schema.
// No network and no live captcha. Run: npm run test:inquiry
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  onRequestPost,
  DB_FAILED_TAG,
  htmlEscape,
  ackFirstName,
  ackDestinationLabel,
  ackBodyText,
  ackBodyHtml,
} from "../functions/api/inquiry.ts";

const ORIGIN = "https://sundayatlastravel.com";
const body = {
  name: "TEST - Project owner check",
  email: "contact@sundayatlastravel.com",
  passport: "Thailand",
  destination: "Poland",
  dates: "March 2027",
  groupSize: "2",
  message: "Automated test after DB restore, please ignore",
  consent: true,
  locale: "en",
  packageSlug: "krakow-jura-outdoor-7-days",
  turnstileToken: "mock-token-0123456789",
};

/** D1-shaped wrapper over an in-memory SQLite database with the repo's migrations. */
function sqliteD1() {
  const sql = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(f, dir), "utf8"));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    run: async () => sql.prepare(q).run(...args),
  });
  return { sql, prepare: (q) => stmt(q) };
}
const brokenD1 = (mode) => ({
  prepare: () => {
    const s = { bind: () => s, run: () => (mode === "hang" ? new Promise(() => {}) : Promise.reject(new Error("D1_ERROR: boom"))) };
    return s;
  },
});

function mockSiteverify(success = true) {
  let other = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("challenges.cloudflare.com")) {
      return Response.json(success ? { success: true, hostname: "sundayatlastravel.com", action: "inquiry" } : { success: false, "error-codes": ["invalid-input-response"] });
    }
    other++;
    throw new Error("unexpected network call " + url);
  };
  return () => other;
}
function mailer(ok, opts = {}) {
  const sent = [];
  return {
    sent,
    fetch: async (_u, init) => {
      const payload = JSON.parse(init.body);
      const isAck = payload != null && payload.to != null;
      if (isAck && opts.ackGate) await opts.ackGate;
      sent.push(payload);
      if (isAck && opts.throwAck) throw new Error("ack fetch failed");
      const success = isAck ? (opts.ackOk ?? ok) : ok;
      return success
        ? Response.json({ ok: true, method: "builder", messageId: "m1" })
        : Response.json({ ok: false, code: "x" }, { status: 502 });
    },
  };
}
async function run(db, mail, patch = {}, hooks = {}) {
  const req = new Request(ORIGIN + "/api/inquiry", {
    method: "POST",
    headers: { Origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...patch }),
  });
  const context = { request: req, env: { TURNSTILE_SECRET_KEY: "ts-test", INQUIRIES_DB: db, INQUIRY_MAIL: mail } };
  if (hooks.waitUntil) context.waitUntil = hooks.waitUntil;
  const res = await onRequestPost(context);
  return { status: res.status, json: await res.json() };
}
function freshLogs(start) {
  return logs.slice(start).join("\n");
}

const keepAlive = setInterval(() => {}, 1000);
const out = { log: console.log, err: console.error, warn: console.warn }, logs = [];
console.error = console.log = console.warn = (...a) => logs.push(a.join(" "));
const cases = [];
async function test(name, fn) { try { await fn(); cases.push(["PASS", name]); } catch (e) { cases.push(["FAIL", name, e.message]); } }

await test("D1 ok + mail ok -> 200, row saved with every field, email_status=sent", async () => {
  mockSiteverify(); const db = sqliteD1(); const m = mailer(true);
  const r = await run(db, m);
  assert.equal(r.status, 200); assert.equal(r.json.saved, true); assert.equal(r.json.email, "sent");
  const row = db.sql.prepare("SELECT * FROM inquiries").get();
  assert.equal(row.name, body.name); assert.equal(row.email, body.email); assert.equal(row.passport_country, body.passport);
  assert.equal(row.travel_dates, body.dates); assert.equal(row.group_size, body.groupSize); assert.equal(row.message, body.message);
  assert.equal(row.package_slug, body.packageSlug); assert.equal(row.locale, "en"); assert.equal(row.consent, 1);
  assert.equal(row.email_status, "sent"); assert.ok(row.email_sent_at);
  assert.equal(m.sent.length, 1);
  assert.ok(!m.sent[0].subject.includes(DB_FAILED_TAG)); assert.ok(m.sent[0].text.includes(row.id));
});
await test("D1 ok + mail fails -> 200, email_status=failed", async () => {
  mockSiteverify(); const db = sqliteD1(); const m = mailer(false);
  const r = await run(db, m);
  assert.equal(r.status, 200); assert.equal(r.json.email, "failed");
  assert.equal(m.sent.length, 1);
  assert.equal(db.sql.prepare("SELECT email_status FROM inquiries").get().email_status, "failed");
});
await test("D1 insert error + mail ok -> 200, '[DB save failed]' email with full enquiry", async () => {
  mockSiteverify(); const m = mailer(true);
  const r = await run(brokenD1("error"), m);
  assert.equal(r.status, 200); assert.equal(r.json.saved, false);
  assert.equal(m.sent.length, 1);
  assert.ok(m.sent[0].subject.startsWith(DB_FAILED_TAG));
  for (const v of [body.name, body.email, body.passport, body.dates, body.groupSize, body.message, body.packageSlug]) assert.ok(m.sent[0].text.includes(v), v);
  assert.ok(m.sent[0].text.includes("NOT saved"));
});
await test("D1 hangs -> gives up after ~5s, email still sent, 200", async () => {
  mockSiteverify(); const m = mailer(true); const t = Date.now();
  const r = await run(brokenD1("hang"), m); const ms = Date.now() - t;
  assert.equal(r.status, 200); assert.equal(m.sent.length, 1); assert.ok(m.sent[0].subject.startsWith(DB_FAILED_TAG));
  assert.ok(ms >= 4900 && ms < 7000, "took " + ms);
  assert.ok(logs.some((l) => l.includes('"status":"timeout"')));
});
await test("No D1 binding + mail ok -> 200, tagged email", async () => {
  mockSiteverify(); const m = mailer(true);
  const r = await run(undefined, m);
  assert.equal(r.status, 200); assert.equal(m.sent.length, 1); assert.ok(m.sent[0].subject.startsWith(DB_FAILED_TAG));
});
await test("D1 fails + mail fails -> 502 error", async () => {
  mockSiteverify(); const m = mailer(false);
  const r = await run(brokenD1("error"), m);
  assert.equal(r.status, 502); assert.equal(r.json.ok, false); assert.equal(m.sent.length, 1);
});
await test("Captcha failure still blocks: nothing saved, nothing sent", async () => {
  mockSiteverify(false); const db = sqliteD1(); const m = mailer(true);
  const r = await run(db, m);
  assert.equal(r.status, 403); assert.equal(m.sent.length, 0);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM inquiries").get().n, 0);
});
await test("No Supabase or other network calls; logs hold no personal data or secrets", async () => {
  const others = mockSiteverify(); const m = mailer(true); await run(sqliteD1(), m); assert.equal(others(), 0);
  assert.equal(m.sent.length, 1);
  for (const v of [body.name, body.email, body.message, body.passport, "ts-test"]) assert.ok(!logs.some((l) => l.includes(v)), "log leaked " + v);
});

const ACK_TEXT = [
  "Hi Maya,",
  "",
  "Thank you for your enquiry about Poland. We've received it and will try to reply within 24 hours with availability and a price.",
  "",
  "If you think of anything to add, such as dates, group size or special requests, just reply to this email.",
  "",
  "Warm regards,",
  "Jeremy",
  "Sunday Atlas Travel",
].join("\n");
const ACK_HTML =
  "<p>Hi Maya,</p><p>Thank you for your enquiry about Poland. We've received it and will try to reply within 24 hours with availability and a price.</p><p>If you think of anything to add, such as dates, group size or special requests, just reply to this email.</p><p>Warm regards,<br>Jeremy<br>Sunday Atlas Travel</p>";

await test("Saved enquiry sends the team mail, then a customer acknowledgement", async () => {
  mockSiteverify(); const db = sqliteD1(); const m = mailer(true);
  const r = await run(db, m, { name: "Maya Lopez", email: "visitor@example.com", destination: "Poland" });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.saved, true); assert.equal(r.json.email, "sent");
  assert.deepEqual(Object.keys(r.json).sort(), ["email", "ok", "saved"]);
  assert.equal(db.sql.prepare("SELECT email_status FROM inquiries").get().email_status, "sent");
  assert.equal(m.sent.length, 2);
  assert.deepEqual(Object.keys(m.sent[0]).sort(), ["replyTo", "subject", "text"]);
  assert.equal(m.sent[0].replyTo, "visitor@example.com");
  assert.equal(m.sent[0].subject, "Trip inquiry: Maya Lopez · Poland · krakow-jura-outdoor-7-days · March 2027");
  assert.ok(m.sent[0].text.includes("Maya Lopez"));
  assert.equal(m.sent[1].text, ACK_TEXT);
  assert.equal(m.sent[1].text.split("\n").length, 9);
  assert.ok(!m.sent[1].text.endsWith("\n"));
  assert.ok(m.sent[1].text.includes("Hi Maya,"));
  assert.ok(m.sent[1].text.includes("about Poland"));
  assert.ok(!m.sent[1].text.includes("Hi Maya Lopez"));
  assert.equal(m.sent[1].text.charCodeAt(m.sent[1].text.indexOf("We've") + 2), 39);
  assert.deepEqual(m.sent[1], {
    to: "visitor@example.com",
    from: "contact@sundayatlastravel.com",
    fromName: "Sunday Atlas Travel",
    replyTo: "contact@sundayatlastravel.com",
    subject: "We received your trip enquiry",
    text: ackBodyText("Maya Lopez", "Poland"),
    html: ackBodyHtml("Maya Lopez", "Poland"),
  });
  assert.equal(m.sent[1].html, ACK_HTML);
  assert.equal(ackBodyText("Maya Lopez", "Poland"), ACK_TEXT);
});

await test("TEST prefix skips the acknowledgement; Contest Winner still gets one", async () => {
  for (const name of ["test Person", "Test Person", "  TEST Person"]) {
    mockSiteverify(); const db = sqliteD1(); const m = mailer(true);
    const r = await run(db, m, { name });
    assert.equal(r.status, 200, name);
    assert.equal(m.sent.length, 1, name);
    assert.equal(m.sent[0].to, undefined, name);
    assert.equal(db.sql.prepare("SELECT name FROM inquiries").get().name, name.trim());
  }
  mockSiteverify(); const db = sqliteD1(); const m = mailer(true);
  const r = await run(db, m, { name: "Contest Winner", email: "visitor@example.com" });
  assert.equal(r.status, 200);
  assert.equal(m.sent.length, 2);
  assert.equal(m.sent[0].to, undefined);
  assert.equal(m.sent[1].to, "visitor@example.com");
  assert.ok(m.sent[1].text.includes("Hi Contest,"));
});

await test("Acknowledgement uses the first name; blank names stay out of the request path", async () => {
  assert.equal(ackFirstName(""), "there");
  assert.equal(ackFirstName("   "), "there");
  assert.equal(ackFirstName("\t"), "there");
  assert.equal(ackFirstName("  Maya Lopez"), "Maya");
  mockSiteverify(); const db = sqliteD1(); const m = mailer(true);
  const r = await run(db, m, { name: "  Maya Lopez", email: "visitor@example.com" });
  assert.equal(r.status, 200);
  assert.equal(db.sql.prepare("SELECT name FROM inquiries").get().name, "Maya Lopez");
  assert.equal(m.sent.length, 2);
  assert.ok(m.sent[1].text.includes("Hi Maya,"));
  assert.ok(!m.sent[1].text.includes("Hi Maya Lopez"));
});

await test("Undecided destination is acknowledged as your trip", async () => {
  assert.equal(ackDestinationLabel(""), "your trip");
  assert.equal(ackDestinationLabel("undecided"), "your trip");
  assert.equal(ackDestinationLabel("  UNDECIDED  "), "your trip");
  assert.equal(ackDestinationLabel("Poland"), "Poland");
  for (const destination of ["undecided", "Undecided"]) {
    mockSiteverify(); const db = sqliteD1(); const m = mailer(true);
    const r = await run(db, m, { name: "Maya Lopez", email: "visitor@example.com", destination });
    assert.equal(r.status, 200, destination);
    assert.ok(m.sent[1].text.includes("about your trip."), destination);
    assert.ok(!m.sent[1].text.toLowerCase().includes("undecided"), destination);
    assert.ok(!m.sent[1].html.toLowerCase().includes("undecided"), destination);
  }
});

await test("Acknowledgement HTML-escapes the visitor's name and destination", async () => {
  assert.equal(htmlEscape(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(htmlEscape("Tom <script>"), "Tom &lt;script&gt;");
  assert.equal(htmlEscape(`Poland & "Alps"`), "Poland &amp; &quot;Alps&quot;");
  mockSiteverify(); const db = sqliteD1(); const m = mailer(true);
  const r = await run(db, m, { name: "Tom <script>", email: "visitor@example.com", destination: `Poland & "Alps"` });
  assert.equal(r.status, 200);
  assert.equal(r.json.saved, true);
  const text = m.sent[1].text;
  const html = m.sent[1].html;
  assert.ok(text.includes("Hi Tom,"));
  assert.ok(text.includes(`Poland & "Alps"`));
  assert.ok(!text.includes("&amp;"));
  assert.ok(!text.includes("&lt;"));
  assert.ok(html.includes("Poland &amp; &quot;Alps&quot;"));
  assert.ok(!html.includes("<script"));
  assert.ok(ackBodyText("Tom<script> Lopez", "Poland").includes("Hi Tom<script>,"));
  assert.ok(ackBodyHtml("Tom<script> Lopez", "Poland").includes("Tom&lt;script&gt;"));
  assert.ok(!ackBodyHtml("Tom<script> Lopez", "Poland").includes("<script"));
});

await test("Ack failure does not change the team result or email_status", async () => {
  const patch = { name: "Maya Lopez", email: "visitor@example.com", destination: "Poland" };
  {
    mockSiteverify(); const db = sqliteD1(); const m = mailer(true, { ackOk: false }); const start = logs.length;
    const r = await run(db, m, patch);
    assert.equal(r.status, 200); assert.equal(r.json.email, "sent");
    assert.equal(db.sql.prepare("SELECT email_status FROM inquiries").get().email_status, "sent");
    assert.equal(m.sent.length, 2); assert.equal(m.sent[0].to, undefined); assert.equal(m.sent[1].to, patch.email);
    const fresh = freshLogs(start);
    assert.ok(fresh.includes("inquiry_ack_failed"));
    assert.ok(fresh.includes("send_failed"));
    assert.ok(!fresh.includes(patch.email));
    assert.ok(!fresh.includes(patch.name));
  }
  {
    mockSiteverify(); const db = sqliteD1(); const m = mailer(true, { throwAck: true }); const start = logs.length;
    const r = await run(db, m, patch);
    assert.equal(r.status, 200); assert.equal(r.json.email, "sent");
    assert.equal(db.sql.prepare("SELECT email_status FROM inquiries").get().email_status, "sent");
    assert.equal(m.sent[0].to, undefined);
    const fresh = freshLogs(start);
    assert.ok(fresh.includes("inquiry_ack_failed"));
    assert.ok(fresh.includes("exception"));
    assert.ok(!fresh.includes(patch.email));
    assert.ok(!fresh.includes(patch.name));
  }
  {
    mockSiteverify(); const db = sqliteD1(); const m = mailer(false, { ackOk: true });
    const r = await run(db, m, patch);
    assert.equal(r.status, 200); assert.equal(r.json.email, "failed");
    assert.equal(db.sql.prepare("SELECT email_status FROM inquiries").get().email_status, "failed");
    assert.equal(m.sent.length, 2);
    assert.equal(m.sent[1].to, patch.email);
    assert.equal(m.sent[1].subject, "We received your trip enquiry");
  }
  {
    mockSiteverify(); const db = sqliteD1(); const start = logs.length;
    const r = await run(db, undefined, patch);
    assert.equal(r.status, 200); assert.equal(r.json.saved, true); assert.equal(r.json.email, "failed");
    assert.equal(db.sql.prepare("SELECT email_status FROM inquiries").get().email_status, "failed");
    const fresh = freshLogs(start);
    assert.ok(fresh.includes("inquiry_ack_failed"));
    assert.ok(fresh.includes("unbound"));
    assert.ok(!fresh.includes(patch.email));
    assert.ok(!fresh.includes(patch.name));
  }
  {
    mockSiteverify(); const m = mailer(true);
    const r = await run(brokenD1("error"), m, patch);
    assert.equal(r.status, 200); assert.equal(r.json.saved, false);
    assert.equal(m.sent.length, 1);
    assert.ok(m.sent[0].subject.startsWith(DB_FAILED_TAG));
    assert.equal(m.sent[0].to, undefined);
  }
});

await test("Acknowledgement does not block the HTTP response", async () => {
  mockSiteverify(); const db = sqliteD1();
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = [];
  const m = mailer(true, { ackGate: gate });
  const r = await run(db, m, { name: "Maya Lopez", email: "visitor@example.com", destination: "Poland" }, {
    waitUntil: (promise) => pending.push(promise),
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.email, "sent");
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0].to, undefined);
  assert.ok(m.sent[0].text.includes("Maya Lopez"));
  release();
  await Promise.all(pending);
  assert.equal(m.sent.length, 2);
  assert.equal(m.sent[1].to, "visitor@example.com");
  assert.equal(m.sent[1].subject, "We received your trip enquiry");
  assert.equal(db.sql.prepare("SELECT email_status FROM inquiries").get().email_status, "sent");
});

clearInterval(keepAlive);
Object.assign(console, { log: out.log, error: out.err, warn: out.warn });
for (const c of cases) process.stdout.write(c.join(" | ") + "\n");
process.exit(cases.some((c) => c[0] === "FAIL") ? 1 : 0);
