/**
 * Cloudflare Pages Function: POST /api/translate
 * Server-to-server only. No CORS. Workers AI binding is `AI`.
 *
 * Production model is TRANSLATE_MODEL. `body.model` is honored only when the
 * request hostname is localhost or 127.0.0.1 (local comparisons).
 * TRANSLATE_MOCK_AI=1 on loopback returns a deterministic stand-in for tests.
 * That stand-in matches scripts/lib/auto-translate-core.mjs `mockTranslate`.
 */
export const TRANSLATE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const FALLBACK_TRANSLATE_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

const TARGETS = ["de", "fr", "ja", "es"] as const;
type Target = (typeof TARGETS)[number];
const MAX_ITEMS = 40;
const MAX_CHARS = 14000;
const MAX_TOKENS = 4096;

const LANGUAGE: Record<Target, string> = {
  de: "German",
  fr: "French",
  ja: "Japanese",
  es: "Spanish",
};

interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

interface Env {
  AI?: AiBinding;
  TRANSLATE_SECRET?: string;
  TRANSLATE_MOCK_AI?: string;
}

interface EventContext {
  request: Request;
  env: Env;
}

interface TranslateItem {
  id: string;
  text?: string;
  title?: string;
  focus_keyword?: string;
  keywords?: string[];
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isLoopback(request: Request): boolean {
  try {
    const host = new URL(request.url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function isTarget(value: unknown): value is Target {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

/** SHA-256 both sides, then XOR every byte. No early return. */
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

function systemPrompt(target: Target, mode: "translate" | "keywords"): string {
  const language = LANGUAGE[target];
  const shared = [
    "You are a professional travel copywriter for Sunday Atlas Travel.",
    `Write in ${language}. Natural and idiomatic, not a literal translation.`,
    "Never describe the company as a reseller or intermediary and never mention or name other companies: no partners, local operators, third parties, middlemen or suppliers.",
    'Sunday Atlas Travel plans the trips itself and arranges hotels, transport and guides. Keep first-person ownership natural: "our guide" and "our glamping camp" become e.g. German "unser Guide" / "unser Glamping-Camp", Japanese "当社のガイド" / "当社のグランピングキャンプ", French "notre guide" / "notre camp de glamping", Spanish "nuestro guía" / "nuestro campamento de glamping".',
  ];
  if (mode === "keywords") {
    return [
      ...shared,
      `Produce 8–12 natural search queries people in ${language} would type for this page, in that language and script, lowercase where that is natural, plus one focus keyword.`,
      "Do not translate the English keywords literally. Write native search terms.",
      'Return ONLY a JSON object mapping each id to {"focus_keyword":"...","keywords":["..."]}.',
    ].join(" ");
  }
  return [
    ...shared,
    `Translate the English website copy into ${language}.`,
    "Keep every number, price, currency symbol, unit, date, URL, slug, placeholder, markdown and line breaks exactly.",
    'Keep proper names of places and hotels recognizable. Use the standard exonym in the target language, for example Japanese katakana アルマトイ or German "Almaty".',
    "Use neutral plural nouns for people (German \"Reisende\", \"Gäste\", \"Alleinreisende\"; French \"les voyageurs\"; Spanish \"los viajeros\"). Never use gender-star, colon, underscore or middle-dot forms such as \"Reisende*r\", \"eine*n\", \"Guide:innen\", \"Gäste_innen\" or \"voyageur·euse\".",
    "Use exactly one form for each place name within an entry and keep it in every field, for example German \"Charyn-Canyon\" (never also \"Charyn-Schlucht\"), Japanese \"トゥルゲン\" and \"アッシ高原\" (never mixed variants).",
    "Translate tree and plant species precisely: spruce is German \"Fichte\" and Japanese \"トウヒ\" (not pine/マツ or fir/Tanne/モミ), fir is \"Tanne\"/\"モミ\", pine is \"Kiefer\"/\"マツ\", ash is \"Esche\"/\"トネリコ\", willow is \"Weide\"/\"ヤナギ\". Keep named species with their name (\"Schrenk spruce\" → \"Schrenk-Fichte\" / \"シュレンクトウヒ\").",
    "Keep star ratings like 3* and 4*.",
    "Return ONLY a JSON object mapping each id to its translation string.",
  ].join(" ");
}

function userPrompt(mode: "translate" | "keywords", items: TranslateItem[], context: string): string {
  const lines = [];
  if (context) lines.push(`Context: ${context}`);
  lines.push(mode === "keywords" ? "Write native search terms for each item." : "Translate each item.");
  lines.push(JSON.stringify(items));
  return lines.join("\n");
}

/** Same output as scripts/lib/auto-translate-core.mjs mockTranslate. */
function mockTranslate(target: string, mode: "translate" | "keywords", items: TranslateItem[]): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  if (mode === "keywords") {
    for (const item of items) {
      const keywords: string[] = [];
      for (let n = 1; n <= 8; n += 1) {
        keywords.push(target === "ja" ? `日本 キーワード ${n}` : `${target} kw ${n}`);
      }
      results[item.id] = {
        focus_keyword: target === "ja" ? "日本 フォーカス" : `${target} focus`,
        keywords,
      };
    }
    return results;
  }
  for (const item of items) results[item.id] = `「${target}」 ${item.text ?? ""}`;
  return results;
}

function itemChars(mode: "translate" | "keywords", item: TranslateItem): number {
  if (mode === "keywords") {
    const keywords = Array.isArray(item.keywords) ? item.keywords.join("") : "";
    return (item.title ?? "").length + (item.focus_keyword ?? "").length + keywords.length;
  }
  return (item.text ?? "").length;
}

function stripFences(text: string): string {
  let source = text.trim();
  const wrapped = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (wrapped) source = wrapped[1].trim();
  return source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function extractFirstObject(text: string): Record<string, unknown> | null {
  const source = stripFences(text);
  const start = source.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(source.slice(start, i + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }
        return null;
      }
    }
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") return extractFirstObject(value);
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function unwrapMapping(obj: Record<string, unknown>, ids: string[]): Record<string, unknown> {
  if (ids.some((id) => Object.prototype.hasOwnProperty.call(obj, id))) return obj;
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const inner = obj[keys[0]];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Record<string, unknown>;
  }
  return obj;
}

function keywordValue(value: unknown): { focus_keyword: string; keywords: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { focus_keyword?: unknown; keywords?: unknown };
  if (typeof record.focus_keyword !== "string" || !Array.isArray(record.keywords)) return null;
  const keywords: string[] = [];
  for (const item of record.keywords) {
    if (typeof item !== "string") return null;
    keywords.push(item);
  }
  return { focus_keyword: record.focus_keyword, keywords };
}

function readUsage(
  result: unknown,
  promptChars: number,
  completionChars: number,
): { prompt_tokens: number; completion_tokens: number } {
  const usage =
    result && typeof result === "object" ? (result as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage : undefined;
  const prompt = usage && typeof usage.prompt_tokens === "number" && Number.isFinite(usage.prompt_tokens)
    ? usage.prompt_tokens
    : Math.ceil(promptChars / 4);
  const completion = usage && typeof usage.completion_tokens === "number" && Number.isFinite(usage.completion_tokens)
    ? usage.completion_tokens
    : Math.ceil(completionChars / 4);
  return { prompt_tokens: prompt, completion_tokens: completion };
}

function responseText(result: unknown): unknown {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const response = (result as { response?: unknown }).response;
  if (typeof response === "string") return response;
  if (response && typeof response === "object") return response;
  return "";
}

function parseItems(mode: "translate" | "keywords", raw: unknown): TranslateItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: TranslateItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as { id?: unknown; text?: unknown; title?: unknown; focus_keyword?: unknown; keywords?: unknown };
    if (typeof record.id !== "string" || record.id.length === 0 || seen.has(record.id)) return null;
    seen.add(record.id);
    if (mode === "translate") {
      if (typeof record.text !== "string") return null;
      items.push({ id: record.id, text: record.text });
      continue;
    }
    if (typeof record.title !== "string" || typeof record.focus_keyword !== "string" || !Array.isArray(record.keywords)) {
      return null;
    }
    const keywords: string[] = [];
    for (const keyword of record.keywords) {
      if (typeof keyword !== "string") return null;
      keywords.push(keyword);
    }
    items.push({ id: record.id, title: record.title, focus_keyword: record.focus_keyword, keywords });
  }
  return items;
}

/** Pages calls `onRequestPost` for POST when it is exported, and `onRequest` for every other method. */
export async function onRequestPost(context: EventContext): Promise<Response> {
  return handle(context);
}

export async function onRequest(context: EventContext): Promise<Response> {
  return handle(context);
}

async function handle(context: EventContext): Promise<Response> {
  const { request, env } = context;
  if (request.method.toUpperCase() !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (typeof env.TRANSLATE_SECRET !== "string" || env.TRANSLATE_SECRET.length === 0) {
    return json({ error: "not_configured" }, 503);
  }
  const provided = request.headers.get("x-translate-secret") ?? "";
  const allowed = await secretsMatch(provided, env.TRANSLATE_SECRET);
  if (!allowed) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "invalid" }, 400);
  const record = body as { target?: unknown; mode?: unknown; items?: unknown; context?: unknown; model?: unknown };
  const target = record.target;
  const mode = record.mode;
  if (!isTarget(target)) return json({ error: "invalid" }, 400);
  if (mode !== "translate" && mode !== "keywords") return json({ error: "invalid" }, 400);
  const items = parseItems(mode, record.items);
  if (!items) return json({ error: "invalid" }, 400);
  const contextText = record.context == null ? "" : record.context;
  if (typeof contextText !== "string") return json({ error: "invalid" }, 400);
  const totalChars = items.reduce((sum, item) => sum + itemChars(mode, item), 0) + contextText.length;
  if (items.length > MAX_ITEMS || totalChars > MAX_CHARS) return json({ error: "too_large" }, 413);

  let model = TRANSLATE_MODEL;
  if (isLoopback(request) && record.model !== undefined) {
    if (typeof record.model !== "string" || record.model.trim() === "") return json({ error: "invalid" }, 400);
    model = record.model.trim();
  }

  const ids = items.map((item) => item.id);
  if (env.TRANSLATE_MOCK_AI === "1" && isLoopback(request)) {
    const results = mockTranslate(target, mode, items);
    const promptChars = systemPrompt(target, mode).length + userPrompt(mode, items, contextText).length;
    const completionChars = JSON.stringify(results).length;
    return json(
      {
        model,
        results,
        missing: ids.filter((id) => !Object.prototype.hasOwnProperty.call(results, id)),
        usage: readUsage(null, promptChars, completionChars),
      },
      200,
    );
  }

  if (!env.AI) return json({ error: "ai_error" }, 502);

  const messages = [
    { role: "system", content: systemPrompt(target, mode) },
    { role: "user", content: userPrompt(mode, items, contextText) },
  ];
  let result: unknown;
  try {
    result = await env.AI.run(model, { messages, max_tokens: MAX_TOKENS, temperature: 0.2 });
  } catch {
    if (model === TRANSLATE_MODEL) {
      try {
        model = FALLBACK_TRANSLATE_MODEL;
        result = await env.AI.run(model, { messages, max_tokens: MAX_TOKENS, temperature: 0.2 });
      } catch {
        return json({ error: "ai_error" }, 502);
      }
    } else {
      return json({ error: "ai_error" }, 502);
    }
  }

  const parsed = asObject(responseText(result));
  const mapping = parsed ? unwrapMapping(parsed, ids) : {};
  const results: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const id of ids) {
    const value = mapping[id];
    if (mode === "translate") {
      if (typeof value !== "string") missing.push(id);
      else results[id] = value;
      continue;
    }
    const keywords = keywordValue(value);
    if (!keywords) missing.push(id);
    else results[id] = keywords;
  }
  const promptChars = messages[0].content.length + messages[1].content.length;
  const completionChars = typeof responseText(result) === "string" ? (responseText(result) as string).length : JSON.stringify(results).length;
  return json(
    {
      model,
      results,
      missing,
      usage: readUsage(result, promptChars, completionChars),
    },
    200,
  );
}
