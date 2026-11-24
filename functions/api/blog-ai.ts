/**
 * Cloudflare Pages Function: POST /api/blog-ai
 * Server-to-server only (the daily blog GitHub Action). No CORS.
 * Auth: header `x-translate-secret` must equal the Pages secret TRANSLATE_SECRET
 * (the same secret the translate job already uses, so no new secret is needed).
 *
 * Body (text):  { "model"?: string, "messages": [{role, content}], "max_tokens"?: number, "temperature"?: number }
 * Body (image): { "task": "image", "prompt": string, "steps"?: number }
 * Body (m2m):   { "task": "m2m", "text": string, "target_lang": "de"|"fr"|"ja"|"es" } (one field, last-resort MT)
 * Returns { model, response, usage } for text and { model, image (base64 jpeg) } for images.
 * Only allowlisted models run. Uses the Workers AI binding `AI`.
 */
const TEXT_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
] as const;
const DEFAULT_TEXT_MODEL = TEXT_MODELS[0];
const FALLBACK_TEXT_MODEL = TEXT_MODELS[1];
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const M2M_MODEL = "@cf/meta/m2m100-1.2b";
const M2M_TARGETS = ["de", "fr", "ja", "es"];
const MAX_TOKENS = 4096;
const MAX_PROMPT_CHARS = 40000;

interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

interface Env {
  AI?: AiBinding;
  TRANSLATE_SECRET?: string;
}

interface EventContext {
  request: Request;
  env: Env;
}

type Message = { role: "system" | "user" | "assistant"; content: string };

/** Workers AI daily free allocation used up (error 4006) or account rate limit. */
function isQuotaError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /4006|neurons|daily free allocation|rate limit|capacity|429/i.test(text);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function parseMessages(raw: unknown): Message[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) return null;
  const out: Message[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "system" && role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;
    out.push({ role, content });
  }
  return out;
}

function readUsage(result: unknown): { prompt_tokens: number; completion_tokens: number } | null {
  if (!result || typeof result !== "object") return null;
  const usage = (result as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
  if (!usage) return null;
  const p = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const c = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  return { prompt_tokens: p, completion_tokens: c };
}

function responseOf(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const response = (result as { response?: unknown }).response;
  if (typeof response === "string") return response;
  if (response && typeof response === "object") return JSON.stringify(response);
  return "";
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, env } = context;
  if (request.method.toUpperCase() !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (typeof env.TRANSLATE_SECRET !== "string" || env.TRANSLATE_SECRET.length === 0) {
    return json({ error: "not_configured" }, 503);
  }
  const provided = request.headers.get("x-translate-secret") ?? "";
  if (!(await secretsMatch(provided, env.TRANSLATE_SECRET))) return json({ error: "unauthorized" }, 401);
  if (!env.AI) return json({ error: "ai_error" }, 502);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid" }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "invalid" }, 400);
  }

  if (body.task === "image") {
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > 2000) return json({ error: "invalid" }, 400);
    const steps = typeof body.steps === "number" ? Math.min(8, Math.max(1, Math.round(body.steps))) : 4;
    try {
      const result = (await env.AI.run(IMAGE_MODEL, { prompt, steps })) as { image?: unknown };
      if (typeof result?.image !== "string") return json({ error: "ai_error" }, 502);
      return json({ model: IMAGE_MODEL, image: result.image }, 200);
    } catch (err) {
      if (isQuotaError(err)) return json({ error: "quota_exceeded" }, 429);
      return json({ error: "ai_error" }, 502);
    }
  }

  if (body.task === "m2m") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const target = typeof body.target_lang === "string" ? body.target_lang : "";
    if (!text || text.length > 4000 || !M2M_TARGETS.includes(target)) return json({ error: "invalid" }, 400);
    try {
      const result = (await env.AI.run(M2M_MODEL, { text, source_lang: "en", target_lang: target })) as {
        translated_text?: unknown;
      };
      if (typeof result?.translated_text !== "string") return json({ error: "ai_error" }, 502);
      return json({ model: M2M_MODEL, response: result.translated_text, usage: null }, 200);
    } catch (err) {
      if (isQuotaError(err)) return json({ error: "quota_exceeded" }, 429);
      return json({ error: "ai_error" }, 502);
    }
  }

  const messages = parseMessages(body.messages);
  if (!messages) return json({ error: "invalid" }, 400);
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  if (chars > MAX_PROMPT_CHARS) return json({ error: "too_large" }, 413);
  const requested = typeof body.model === "string" ? body.model : DEFAULT_TEXT_MODEL;
  if (!(TEXT_MODELS as readonly string[]).includes(requested)) return json({ error: "model_not_allowed" }, 400);
  const maxTokens =
    typeof body.max_tokens === "number" ? Math.min(MAX_TOKENS, Math.max(64, Math.round(body.max_tokens))) : 2048;
  const temperature =
    typeof body.temperature === "number" ? Math.min(1.2, Math.max(0, body.temperature)) : 0.6;

  let model: string = requested;
  let result: unknown;
  try {
    result = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature });
  } catch (err) {
    if (isQuotaError(err)) return json({ error: "quota_exceeded" }, 429);
    if (model === FALLBACK_TEXT_MODEL) return json({ error: "ai_error" }, 502);
    try {
      model = FALLBACK_TEXT_MODEL;
      result = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature });
    } catch (err2) {
      if (isQuotaError(err2)) return json({ error: "quota_exceeded" }, 429);
      return json({ error: "ai_error" }, 502);
    }
  }
  return json({ model, response: responseOf(result), usage: readUsage(result) }, 200);
}
