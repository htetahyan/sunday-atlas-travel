/**
 * Signed uploads to the site's Cloudinary account (cloud "di4a4oz3o").
 *
 * Credentials (repo/Actions secrets, never printed):
 *   CLOUDINARY_URL = cloudinary://<api_key>:<api_secret>@di4a4oz3o
 *   or CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET (+ optional CLOUDINARY_CLOUD_NAME).
 * Without them, uploadStatus().ok is false and callers fall back to catalog images.
 */
import { createHash } from "node:crypto";

export const CLOUD_NAME_DEFAULT = "di4a4oz3o";

export function cloudinaryConfig(env = process.env) {
  if (env.CLOUDINARY_URL) {
    const m = String(env.CLOUDINARY_URL).match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (m) return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
  }
  if (env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET)
    return { apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET, cloudName: env.CLOUDINARY_CLOUD_NAME || CLOUD_NAME_DEFAULT };
  return null;
}

export function uploadStatus(env = process.env) {
  return cloudinaryConfig(env)
    ? { ok: true }
    : { ok: false, missing: "CLOUDINARY_URL (cloudinary://<api_key>:<api_secret>@di4a4oz3o), or CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET" };
}

/** Cloudinary signature: sha1 of sorted `k=v` pairs joined by & plus the secret. */
export function signParams(params, apiSecret) {
  const str = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "" && !["file", "api_key", "resource_type", "cloud_name"].includes(k))
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(str + apiSecret).digest("hex");
}

export function safePublicName(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

/**
 * Upload a JPEG buffer. folder e.g. "sunday-atlas/blog/<slug>". Returns
 * { publicId, url, width, height }. `context` is stored on the asset (attribution).
 */
export async function uploadImage(buffer, { folder, name, context = {}, env = process.env, fetchImpl = fetch } = {}) {
  const cfg = cloudinaryConfig(env);
  if (!cfg) throw new Error(`Cloudinary upload credential missing: ${uploadStatus(env).missing}`);
  const params = {
    folder,
    public_id: safePublicName(name),
    overwrite: "false",
    unique_filename: "false",
    context: Object.entries(context)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${String(v).replace(/[|=]/g, " ").slice(0, 250)}`)
      .join("|"),
    timestamp: Math.floor(Date.now() / 1000),
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) if (v !== "") form.append(k, String(v));
  form.append("api_key", cfg.apiKey);
  form.append("signature", signParams(params, cfg.apiSecret));
  form.append("file", new Blob([buffer], { type: "image/jpeg" }), `${params.public_id}.jpg`);
  const res = await fetchImpl(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Cloudinary upload HTTP ${res.status}: ${String(body?.error?.message ?? "").slice(0, 160)}`);
  return { publicId: body.public_id, url: body.secure_url, width: body.width, height: body.height };
}
