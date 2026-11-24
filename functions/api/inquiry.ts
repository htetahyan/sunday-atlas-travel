/**
 * Cloudflare Pages Function: POST /api/inquiry
 * 1. Origin check, honeypot, validation, per-IP rate limit (KV CHAT_RL, inq: keys),
 *    then Cloudflare Turnstile siteverify (fails closed; nothing is saved or sent
 *    without a valid token for the apex or www hostname).
 * 2. Save the row in Cloudflare D1 (binding INQUIRIES_DB, database
 *    "sunday-atlas-inquiries", table inquiries; schema in migrations/), with a short timeout.
 * 3. Email the team through the INQUIRY_MAIL service binding (Worker with send_email).
 *    The email never depends on the save: if the save fails or times out, the email
 *    still goes out with the full enquiry and "[DB save failed]" in the subject.
 *    A saved row also schedules a customer acknowledgement on that same binding.
 *    A name that starts with TEST skips the acknowledgement. Ack failure does not
 *    change the response or email_status.
 * The visitor gets ok when either the save or the email succeeded; an error only when
 * both failed. When the row is saved, its email_status is set to sent or failed.
 */

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Fetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** The small part of the D1 API this function uses. */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
}
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface Env {
  CHAT_RL?: KVNamespaceLike;
  INQUIRY_MAIL?: Fetcher;
  INQUIRIES_DB?: D1DatabaseLike;
  TURNSTILE_SECRET_KEY?: string;
}

interface EventContext {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

const LOCALES = new Set(["en", "de", "fr", "ja", "es", "zh"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9-]{1,120}$/;

/** Per IP: this many inquiries per 10-minute window, and per UTC day. */
const WINDOW_LIMIT = 3;
const DAY_LIMIT = 10;
const WINDOW_MS = 10 * 60 * 1000;

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_HOSTNAMES = new Set(["sundayatlastravel.com", "www.sundayatlastravel.com"]);
const TURNSTILE_ACTION = "inquiry";

/** Database calls give up after this long so a paused or slow database never blocks the email. */
export const DB_TIMEOUT_MS = 5000;
export const DB_FAILED_TAG = "[DB save failed]";

/** Server-side Turnstile check. Any doubt (missing token, network error, wrong hostname) is a failure. */
export async function verifyTurnstile(
  secret: string,
  token: unknown,
  remoteip: string | null,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return { ok: false, detail: "missing_token" };
  }
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteip) form.append("remoteip", remoteip);
  form.append("idempotency_key", crypto.randomUUID());
  let result: { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] };
  try {
    const response = await fetcher(SITEVERIFY, { method: "POST", body: form });
    if (!response.ok) return { ok: false, detail: `http_${response.status}` };
    result = (await response.json()) as typeof result;
  } catch {
    return { ok: false, detail: "fetch" };
  }
  if (result.success !== true) {
    return { ok: false, detail: (result["error-codes"] ?? ["failed"]).join(",").slice(0, 120) };
  }
  if (!result.hostname || !TURNSTILE_HOSTNAMES.has(result.hostname)) {
    return { ok: false, detail: "hostname" };
  }
  if (result.action && result.action !== TURNSTILE_ACTION) {
    return { ok: false, detail: "action" };
  }
  return { ok: true, detail: "ok" };
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.protocol === "https:") {
    const host = url.hostname;
    return (
      host === "sunday-atlas-travel.pages.dev" ||
      host.endsWith(".sunday-atlas-travel.pages.dev") ||
      host === "sundayatlastravel.com" ||
      host === "www.sundayatlastravel.com"
    );
  }
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }
  return false;
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedOrigin(origin)) return null;
  return origin;
}

function clientIp(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = cf || xff || "unknown";
  return raw.replace(/[^A-Za-z0-9:._-]/g, "_").slice(0, 80) || "unknown";
}

async function bump(kv: KVNamespaceLike, key: string, ttl: number): Promise<number> {
  const raw = await kv.get(key);
  const current = raw ? Number.parseInt(raw, 10) : 0;
  const next = (Number.isFinite(current) ? current : 0) + 1;
  await kv.put(key, String(next), { expirationTtl: ttl });
  return next;
}

async function rateLimited(request: Request, env: Env): Promise<boolean> {
  if (!env.CHAT_RL) return false;
  const ip = clientIp(request);
  const now = new Date();
  const bucket = Math.floor(now.getTime() / WINDOW_MS);
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  try {
    const perWindow = await bump(env.CHAT_RL, `inq:10m:${ip}:${bucket}`, 660);
    const perDay = await bump(env.CHAT_RL, `inq:d:${ip}:${day}`, 172800);
    return perWindow > WINDOW_LIMIT || perDay > DAY_LIMIT;
  } catch {
    console.warn("CHAT_RL request failed; skipping the inquiry rate limit for this call.");
    return false;
  }
}

export type Inquiry = {
  name: string;
  email: string;
  passport: string;
  destination: string;
  dates: string;
  groupSize: string;
  message: string;
  packageSlug: string | null;
  locale: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Same limits as the table's check constraints. Returns null when invalid. */
export function parseInquiry(record: Record<string, unknown>): Inquiry | null {
  const data: Inquiry = {
    name: str(record.name),
    email: str(record.email),
    passport: str(record.passport),
    destination: str(record.destination),
    dates: str(record.dates),
    groupSize: str(record.groupSize),
    message: str(record.message),
    packageSlug: str(record.packageSlug) || null,
    locale: str(record.locale),
  };
  if (data.name.length < 2 || data.name.length > 120) return null;
  if (data.email.length > 200 || !EMAIL.test(data.email)) return null;
  if (data.passport.length < 2 || data.passport.length > 80) return null;
  if (data.destination.length < 1 || data.destination.length > 80) return null;
  if (data.dates.length < 2 || data.dates.length > 120) return null;
  if (data.groupSize.length < 1 || data.groupSize.length > 40) return null;
  if (data.message.length < 10 || data.message.length > 4000) return null;
  if (record.consent !== true) return null;
  if (!LOCALES.has(data.locale)) return null;
  if (data.packageSlug !== null && !SLUG.test(data.packageSlug)) data.packageSlug = null;
  return data;
}

function oneLine(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function mailSubject(data: Inquiry, dbSaved = true): string {
  const parts = [
    oneLine(data.name, 80),
    oneLine(data.destination, 40),
    data.packageSlug ? oneLine(data.packageSlug, 60) : "no package",
    oneLine(data.dates, 60),
  ];
  const prefix = dbSaved ? "" : `${DB_FAILED_TAG} `;
  return oneLine(`${prefix}Trip inquiry: ${parts.join(" · ")}`, 230);
}

export function mailText(data: Inquiry, id: string | null, savedAt: Date): string {
  return [
    `New trip inquiry from sundayatlastravel.com (${data.locale})`,
    "",
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Passport / nationality: ${data.passport}`,
    `Destination: ${data.destination}`,
    `Package: ${data.packageSlug ?? "none"}`,
    `Dates: ${data.dates}`,
    `Group size: ${data.groupSize}`,
    "",
    "Message:",
    data.message,
    "",
    id
      ? `Saved: ${savedAt.toISOString()} (D1 inquiries id ${id})`
      : `Received: ${savedAt.toISOString()}. NOT saved in the database (save failed or timed out); this email is the only copy.`,
    "Reply to this email to answer the visitor directly.",
  ].join("\n");
}

const ACK_SUBJECT = "We received your trip enquiry";
const ACK_FROM = "contact@sundayatlastravel.com";
const ACK_FROM_NAME = "Sunday Atlas Travel";
const ACK_REPLY_TO = "contact@sundayatlastravel.com";

export function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function ackFirstName(name: string): string {
  const token = /^\S+/.exec(name.trim())?.[0] ?? "";
  return token.length > 0 ? token : "there";
}

export function ackDestinationLabel(destination: string): string {
  const trimmed = destination.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "undecided") return "your trip";
  return trimmed;
}

export function shouldSendInquiryAck(name: string): boolean {
  return !name.trim().toLowerCase().startsWith("test");
}

export function ackBodyText(name: string, destination: string): string {
  const who = ackFirstName(name);
  const where = ackDestinationLabel(destination);
  return [
    `Hi ${who},`,
    "",
    `Thank you for your enquiry about ${where}. We've received it and will try to reply within 24 hours with availability and a price.`,
    "",
    "If you think of anything to add, such as dates, group size or special requests, just reply to this email.",
    "",
    "Warm regards,",
    "Jeremy",
    "Sunday Atlas Travel",
  ].join("\n");
}

export function ackBodyHtml(name: string, destination: string): string {
  const who = htmlEscape(ackFirstName(name));
  const where = htmlEscape(ackDestinationLabel(destination));
  return (
    `<p>Hi ${who},</p>` +
    `<p>Thank you for your enquiry about ${where}. We've received it and will try to reply within 24 hours with availability and a price.</p>` +
    `<p>If you think of anything to add, such as dates, group size or special requests, just reply to this email.</p>` +
    `<p>Warm regards,<br>Jeremy<br>Sunday Atlas Travel</p>`
  );
}

/** Reject after ms so a slow or broken database never holds up the email. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const INSERT_SQL =
  "INSERT INTO inquiries (id, created_at, name, email, passport_country, destination, travel_dates, " +
  "group_size, message, package_slug, locale, consent, email_status) " +
  "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, 'pending')";

async function saveInquiry(db: D1DatabaseLike, data: Inquiry, savedAt: Date): Promise<string> {
  const id = crypto.randomUUID();
  await withTimeout(
    db
      .prepare(INSERT_SQL)
      .bind(
        id,
        savedAt.toISOString(),
        data.name,
        data.email,
        data.passport,
        data.destination,
        data.dates,
        data.groupSize,
        data.message,
        data.packageSlug,
        data.locale,
      )
      .run(),
    DB_TIMEOUT_MS,
  );
  return id;
}

type MailOutcome = { ok: boolean; detail: string };

async function sendMail(env: Env, data: Inquiry, id: string | null, savedAt: Date): Promise<MailOutcome> {
  if (!env.INQUIRY_MAIL) return { ok: false, detail: "INQUIRY_MAIL not bound" };
  try {
    const response = await env.INQUIRY_MAIL.fetch("https://inquiry-mail.internal/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: mailSubject(data, id !== null),
        text: mailText(data, id, savedAt),
        replyTo: data.email,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok && body.ok === true) {
      return { ok: true, detail: `${String(body.method ?? "")} ${String(body.messageId ?? "")}`.trim() };
    }
    return { ok: false, detail: `${response.status} ${String(body.code ?? "")}`.trim() };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "mail fetch failed" };
  }
}

/** Customer acknowledgement. Never throws, and never updates email_status. */
async function sendAck(env: Env, data: Inquiry, id: string | null): Promise<void> {
  if (!env.INQUIRY_MAIL) {
    console.error(JSON.stringify({ event: "inquiry_ack_failed", status: "unbound" }));
    return;
  }
  try {
    const response = await env.INQUIRY_MAIL.fetch("https://inquiry-mail.internal/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: data.email,
        from: ACK_FROM,
        fromName: ACK_FROM_NAME,
        replyTo: ACK_REPLY_TO,
        subject: ACK_SUBJECT,
        text: ackBodyText(data.name, data.destination),
        html: ackBodyHtml(data.name, data.destination),
      }),
    });
    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      console.error(JSON.stringify({ event: "inquiry_ack_failed", status: "send_failed" }));
      return;
    }
    if (!response.ok || payload.ok !== true) {
      console.error(JSON.stringify({ event: "inquiry_ack_failed", status: "send_failed" }));
      return;
    }
    if (id !== null) console.log(JSON.stringify({ event: "inquiry_ack_sent", id }));
  } catch {
    console.error(JSON.stringify({ event: "inquiry_ack_failed", status: "exception" }));
  }
}

async function markEmail(db: D1DatabaseLike, id: string, outcome: MailOutcome): Promise<void> {
  try {
    await withTimeout(
      db
        .prepare(
          "UPDATE inquiries SET email_status = ?2, email_error = ?3, email_sent_at = ?4 " +
            "WHERE id = ?1 AND email_status = 'pending'",
        )
        .bind(
          id,
          outcome.ok ? "sent" : "failed",
          outcome.ok ? null : outcome.detail.slice(0, 500),
          outcome.ok ? new Date().toISOString() : null,
        )
        .run(),
      DB_TIMEOUT_MS,
    );
  } catch {
    console.warn(JSON.stringify({ event: "inquiry_mark_failed" }));
  }
}

export async function onRequestOptions(context: EventContext): Promise<Response> {
  const origin = requestOrigin(context.request);
  if (!origin) return json({ ok: false, reason: "forbidden_origin" }, 403, null);
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
}

export async function onRequestPost(context: EventContext): Promise<Response> {
  const { request, env } = context;
  const origin = requestOrigin(request);
  if (!origin) return json({ ok: false, reason: "forbidden_origin" }, 403, null);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400, origin);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, reason: "invalid" }, 400, origin);
  }
  const record = body as Record<string, unknown>;

  // Honeypot: look like success, save and send nothing.
  if (typeof record.website === "string" && record.website.trim() !== "") {
    return json({ ok: true }, 200, origin);
  }

  const data = parseInquiry(record);
  if (!data) return json({ ok: false, reason: "invalid" }, 400, origin);

  // The captcha secret is required. D1 or the mail binding may be missing; the
  // other channel then carries the enquiry. Only with neither is the form unavailable.
  const db = env.INQUIRIES_DB;
  if (!env.TURNSTILE_SECRET_KEY || (!db && !env.INQUIRY_MAIL)) {
    console.error(JSON.stringify({ event: "inquiry_not_configured" }));
    return json({ ok: false, reason: "not_configured" }, 503, origin);
  }

  if (await rateLimited(request, env)) {
    return json({ ok: false, reason: "rate_limited" }, 429, origin);
  }

  const challenge = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    record.turnstileToken,
    request.headers.get("CF-Connecting-IP"),
  );
  if (!challenge.ok) {
    console.warn(JSON.stringify({ event: "inquiry_turnstile_failed", detail: challenge.detail }));
    return json({ ok: false, reason: "challenge" }, 403, origin);
  }

  const savedAt = new Date();
  let id: string | null = null;
  if (db) {
    try {
      id = await saveInquiry(db, data, savedAt);
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      console.error(JSON.stringify({ event: "inquiry_save_failed", status: timedOut ? "timeout" : "d1_error" }));
    }
  } else {
    console.error(JSON.stringify({ event: "inquiry_save_failed", status: "not_configured" }));
  }

  const outcome = await sendMail(env, data, id, savedAt);
  if (outcome.ok) {
    console.log(JSON.stringify({ event: "inquiry_mail_sent", id, dbSaved: id !== null }));
  } else {
    console.error(JSON.stringify({ event: "inquiry_mail_failed", id, dbSaved: id !== null }));
  }

  if (!id && !outcome.ok) {
    console.error(JSON.stringify({ event: "inquiry_lost" }));
    return json({ ok: false, reason: "error" }, 502, origin);
  }

  if (id && db) {
    const mark = markEmail(db, id, outcome);
    if (context.waitUntil) context.waitUntil(mark);
    else await mark;
  }

  if (id !== null && shouldSendInquiryAck(data.name)) {
    const ack = sendAck(env, data, id);
    if (context.waitUntil) context.waitUntil(ack);
    else await ack;
  }

  return json({ ok: true, saved: id !== null, email: outcome.ok ? "sent" : "failed" }, 200, origin);
}
