/**
 * Cloudflare Pages Function: POST /api/subscribe
 * Email sign-up for travel guides, new itineraries and deals. Free tier only:
 * - Origin check, honeypot field ("website"), email validation.
 * - Per-IP rate limit in the existing KV namespace CHAT_RL (sub: keys).
 * - Stores one Sanity document per email (type "subscriber") through the Mutations API.
 *   The document _id is "subscribers.<sha256(email)>", which dedupes repeat sign-ups
 *   (createIfNotExists) and keeps the record private: Sanity never serves documents
 *   whose _id contains a "." to unauthenticated readers of a public dataset.
 * Nothing is emailed to subscribers; this endpoint only stores the address.
 *
 * Pages secret (set by .github/workflows/deploy-pages.yml, never in git):
 *   SANITY_SUBSCRIBE_TOKEN  Sanity token with write access to dataset "production".
 */

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
  CHAT_RL?: KVNamespaceLike;
  SANITY_SUBSCRIBE_TOKEN?: string;
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
}

interface EventContext {
  request: Request;
  env: Env;
}

const LOCALES = new Set(["en", "de", "fr", "ja", "es"]);
const EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[a-z]{2,24}$/i;
const WINDOW_LIMIT = 5;
const DAY_LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

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
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return false;
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedOrigin(origin)) return null;
  return origin;
}

function clientIp(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  const raw = cf || "unknown";
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
  const now = Date.now();
  const bucket = Math.floor(now / WINDOW_MS);
  const day = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
  try {
    const perWindow = await bump(env.CHAT_RL, `sub:10m:${ip}:${bucket}`, 660);
    const perDay = await bump(env.CHAT_RL, `sub:d:${ip}:${day}`, 172800);
    return perWindow > WINDOW_LIMIT || perDay > DAY_LIMIT;
  } catch {
    return false;
  }
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL.test(email)) return null;
  const [local] = email.split("@");
  if (!local || local.length > 64) return null;
  return email;
}

export function cleanSourcePage(value: unknown): string {
  if (typeof value !== "string") return "";
  const path = value.trim().slice(0, 200);
  return /^\/[A-Za-z0-9\-._~/%]*$/.test(path) ? path : "";
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function subscriberId(email: string): Promise<string> {
  return `subscribers.${(await sha256Hex(email)).slice(0, 40)}`;
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

  let record: Record<string, unknown>;
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("shape");
    record = body as Record<string, unknown>;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400, origin);
  }

  // Honeypot: look like success, store nothing.
  if (typeof record.website === "string" && record.website.trim() !== "") {
    return json({ ok: true }, 200, origin);
  }

  const email = normalizeEmail(record.email);
  if (!email) return json({ ok: false, reason: "invalid" }, 400, origin);

  if (await rateLimited(request, env)) {
    return json({ ok: false, reason: "rate_limited" }, 429, origin);
  }

  const token = env.SANITY_SUBSCRIBE_TOKEN;
  if (!token) {
    console.warn(JSON.stringify({ event: "subscribe_unconfigured" }));
    return json({ ok: false, reason: "unavailable" }, 503, origin);
  }

  const locale = typeof record.locale === "string" && LOCALES.has(record.locale) ? record.locale : "en";
  const projectId = env.SANITY_PROJECT_ID || "mi09tcmc";
  const dataset = env.SANITY_DATASET || "production";
  const doc = {
    _id: await subscriberId(email),
    _type: "subscriber",
    email,
    locale,
    sourcePage: cleanSourcePage(record.sourcePage),
    placement: typeof record.source === "string" && /^[a-z-]{1,20}$/.test(record.source) ? record.source : "",
    createdAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(
      `https://${projectId}.api.sanity.io/v2023-10-01/data/mutate/${dataset}?returnIds=true&visibility=async`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mutations: [{ createIfNotExists: doc }] }),
      },
    );
    if (!response.ok) {
      console.warn(JSON.stringify({ event: "subscribe_store_failed", status: response.status }));
      return json({ ok: false, reason: "unavailable" }, 502, origin);
    }
  } catch {
    console.warn(JSON.stringify({ event: "subscribe_store_failed", status: 0 }));
    return json({ ok: false, reason: "unavailable" }, 502, origin);
  }

  return json({ ok: true }, 200, origin);
}

/** Every other method. */
export async function onRequest(context: EventContext): Promise<Response> {
  const method = context.request.method.toUpperCase();
  if (method === "POST") return onRequestPost(context);
  if (method === "OPTIONS") return onRequestOptions(context);
  return json({ ok: false, reason: "method_not_allowed" }, 405, null);
}
