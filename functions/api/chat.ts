/**
 * Cloudflare Pages Function: POST /api/chat
 * Retrieval is the build-time index in /chat-index/{locale}.json.
 * The model never supplies URLs. Amounts must come from the retrieved index.
 *
 * Cheaper alternative for a local comparison only: "@cf/meta/llama-3.1-8b-instruct-fast".
 * Production always uses CHAT_MODEL. CHAT_MODEL_OVERRIDE is honored only when the
 * request hostname is localhost or 127.0.0.1.
 */
export const CHAT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

/** All visitors share this many model calls per UTC day when CHAT_RL is bound. */
export const DAILY_CHAT_CAP = 800;

import { mockAi } from "./_mock-ai";
import { copy, isLocale, perPerson, type Locale } from "./_i18n";

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

interface Env {
  AI?: AiBinding;
  CHAT_RL?: KVNamespaceLike;
  ASSETS?: { fetch: typeof fetch };
  CHAT_MODEL_OVERRIDE?: string;
  CHAT_MOCK_AI?: string;
}

interface EventContext {
  request: Request;
  env: Env;
}

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

interface PriceRow {
  label?: string;
  prices?: number[];
  singleSupplement?: string;
}

interface PriceTable {
  caption?: string;
  groupSizes?: string[];
  rows?: PriceRow[];
  note?: string;
}

/** Listed per-person price, copied from the package page. Absent when the price is on request. */
interface ListedPrice {
  from?: number;
  currency?: string;
  fromLabel?: string;
  note?: string;
  table?: PriceTable;
}

interface IndexEntry {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  summary?: string;
  durationDays?: number;
  highlights?: string[];
  priceText?: string;
  price?: ListedPrice;
  keywords?: string[];
}

interface Link {
  title: string;
  url: string;
}

interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Runs of Han, Hiragana, Katakana, and Hangul. The long-vowel mark ー (U+30FC)
 * and its halfwidth form are included: Unicode files them as Common, but they
 * belong inside a word such as ツアー.
 */
const CJK_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30fc\uff70]+/gu;

/** Bigrams made only of these hiragana particles are ignored on the query. */
const HIRAGANA_PARTICLES = new Set(["の", "に", "つ", "い", "て", "を", "は", "が", "で", "と", "も", "か"]);

const PRICE_QUESTION =
  /(?:^|[^\p{L}\p{N}])(?:price|cost|how much|preis|kosten|prix|co[uû]t|precio|cu[aá]nto)(?=$|[^\p{L}\p{N}])|料金|値段|価格|いくら/iu;

/** A plain integer, or groups of three digits joined by a thousands separator. */
const NUMBER_TOKEN = String.raw`\d{1,3}(?:[.,\u00A0\u202F ]\d{3})+|\d+`;

const CURRENCY_UNIT = String.raw`[$€¥£]|円|ドル|(?<![A-Za-z])(?:USD|EUR|GBP|JPY|CHF)(?![A-Za-z])`;

/** Retrieved pages sent to the model. Stay inside 3–5 so a reply fits the free allowance. */
const CONTEXT_ENTRIES = 4;
/** Content buttons before the contact link. Three plus contact is at most four links. */
const LINK_MATCHES = 3;

/**
 * Latin tokens shorter than this, and the stopwords below, do not count toward a match.
 * CJK runs stay whole and as character bigrams, including ones that are one or two characters.
 * Query bigrams made only of common hiragana particles do not count.
 */
const MIN_LATIN_TOKEN = 3;

const STOPWORDS = new Set([
  "the",
  "and",
  "is",
  "a",
  "an",
  "of",
  "to",
  "for",
  "with",
  "eine",
  "ein",
  "der",
  "die",
  "das",
  "und",
  "ist",
  "gibt",
  "es",
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "et",
  "est",
  "el",
  "los",
  "las",
  "una",
  "y",
  "de",
  "en",
  "que",
  "how",
  "what",
  "does",
  "wie",
  "was",
]);

const LATIN_WORD = /^\p{Script=Latin}+$/u;
const SUMMARY_MAX = 300;
const HIGHLIGHTS_MAX = 5;
const HISTORY_TURNS = 6;
const HISTORY_CHARS = 500;
const MESSAGE_MAX = 500;
const MAX_TOKENS = 300;
const AI_TIMEOUT_MS = 15_000;

const WINDOW_MS = 10 * 60 * 1000;
const WINDOW_LIMIT = 20;
const DAY_LIMIT = 100;
/** About two days, so a UTC day key outlives the date it counts. */
const DAILY_CAP_TTL_SECONDS = 172800;

let rateLimitWarned = false;

function warnRateLimitDisabled(): void {
  if (rateLimitWarned) return;
  rateLimitWarned = true;
  console.warn("CHAT_RL is not bound; chat rate limiting is disabled.");
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

function isAllowedOrigin(origin: string): boolean {
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

function isLoopback(request: Request): boolean {
  try {
    const host = new URL(request.url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function scriptOf(char: string): string {
  if (char === "ー" || char === "ｰ") return "Kana";
  if (/\p{Script=Hiragana}/u.test(char)) return "Hira";
  if (/\p{Script=Katakana}/u.test(char)) return "Kana";
  if (/\p{Script=Han}/u.test(char)) return "Han";
  if (/\p{Script=Hangul}/u.test(char)) return "Hang";
  return "Other";
}

/** Hiragana particles would otherwise glue the next word onto the previous one. */
function splitScripts(run: string): string[] {
  const parts: string[] = [];
  let current = "";
  let script = "";
  for (const char of Array.from(run)) {
    let next = scriptOf(char);
    if ((char === "ー" || char === "ｰ") && script) next = script;
    if (current && next !== script) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
    script = next;
  }
  if (current) parts.push(current);
  return parts;
}

/** CJK words, split by script. A number written against the first word is kept (3スタン). */
function cjkPieces(text: string): string[] {
  const pieces: string[] = [];
  CJK_RUN.lastIndex = 0;
  for (const match of text.matchAll(CJK_RUN)) {
    const segments = splitScripts(match[0]);
    const start = match.index ?? 0;
    let digits = "";
    for (let i = start - 1; i >= 0 && /\d/u.test(text[i] ?? ""); i -= 1) digits = (text[i] ?? "") + digits;
    if (digits && segments[0]) pieces.push(digits + segments[0]);
    pieces.push(...segments);
  }
  return pieces;
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const parts = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = new Set(parts);
  for (const run of cjkPieces(lower)) {
    out.add(run);
    const chars = Array.from(run);
    for (let i = 0; i < chars.length - 1; i += 1) {
      out.add(chars[i] + chars[i + 1]);
    }
  }
  return [...out];
}

function isParticleBigram(token: string): boolean {
  const chars = Array.from(token);
  return chars.length === 2 && HIRAGANA_PARTICLES.has(chars[0]) && HIRAGANA_PARTICLES.has(chars[1]);
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
  if (!env.CHAT_RL) {
    warnRateLimitDisabled();
    return false;
  }
  const ip = clientIp(request);
  const now = new Date();
  const bucket = Math.floor(now.getTime() / WINDOW_MS);
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  try {
    const perWindow = await bump(env.CHAT_RL, `rl:10m:${ip}:${bucket}`, 660);
    const perDay = await bump(env.CHAT_RL, `rl:d:${ip}:${day}`, 172800);
    return perWindow > WINDOW_LIMIT || perDay > DAY_LIMIT;
  } catch {
    console.warn("CHAT_RL request failed; skipping the rate limit for this call.");
    return false;
  }
}

/** UTC date, `YYYY-MM-DD`, for the shared daily counter. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Returns true when the global day counter is already at the cap.
 * Otherwise increments it (best effort, not atomic) and returns false.
 * A missing CHAT_RL binding skips the cap.
 */
async function blockedByDailyCap(env: Env): Promise<boolean> {
  if (!env.CHAT_RL) return false;
  const key = `cap:${utcDay(new Date())}`;
  try {
    const raw = await env.CHAT_RL.get(key);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    if (count >= DAILY_CHAT_CAP) return true;
    await env.CHAT_RL.put(key, String(count + 1), { expirationTtl: DAILY_CAP_TTL_SECONDS });
    return false;
  } catch {
    console.warn("CHAT_RL daily cap failed; skipping the cap for this call.");
    return false;
  }
}

function contactLink(locale: Locale): Link {
  return { title: copy[locale].contactLinkTitle, url: `/${locale}/contact/` };
}

function readHistory(value: unknown): HistoryTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: HistoryTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, HISTORY_CHARS);
    if (!trimmed) continue;
    turns.push({ role, content: trimmed });
  }
  return turns.slice(-HISTORY_TURNS);
}

async function loadIndex(request: Request, env: Env, locale: Locale): Promise<IndexEntry[]> {
  const url = new URL(`/chat-index/${locale}.json`, request.url);
  const read = async (response: Response): Promise<IndexEntry[] | null> => {
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return Array.isArray(data) ? (data as IndexEntry[]) : null;
  };
  try {
    if (env.ASSETS?.fetch) {
      const viaAssets = await read(await env.ASSETS.fetch(url));
      if (viaAssets) return viaAssets;
    }
  } catch {
    console.warn("ASSETS fetch for the chat index failed.");
  }
  try {
    const viaFetch = await read(await fetch(url));
    if (viaFetch) return viaFetch;
  } catch {
    console.warn("Fetch for the chat index failed.");
  }
  return [];
}

function scoringTokens(text: string): Set<string> {
  const query = new Set<string>();
  for (const token of tokenize(text)) {
    if (STOPWORDS.has(token)) continue;
    if (isParticleBigram(token)) continue;
    if (LATIN_WORD.test(token) && token.length < MIN_LATIN_TOKEN) continue;
    query.add(token);
  }
  return query;
}

function scoreEntry(entry: IndexEntry, query: Set<string>): number {
  const title = new Set(tokenize(entry.title ?? ""));
  const keywords = new Set(tokenize((entry.keywords ?? []).join(" ")));
  const summary = new Set(tokenize(entry.summary ?? ""));
  const highlights = new Set(tokenize((entry.highlights ?? []).join(" ")));
  let score = 0;
  for (const token of query) {
    // CJK bigrams use the same title and keyword weights as other tokens.
    if (title.has(token)) score += 4;
    if (keywords.has(token)) score += 3;
    if (highlights.has(token)) score += 1;
    if (summary.has(token)) score += 1;
  }
  return score;
}

function topEntries(entries: IndexEntry[], queryText: string): IndexEntry[] {
  const query = scoringTokens(queryText);
  return entries
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, query) }))
    .filter((item) => item.score > 0 && item.entry.title && item.entry.url)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, CONTEXT_ENTRIES)
    .map((item) => item.entry);
}

function clampSummary(summary: string | undefined): string {
  const clean = (summary ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= SUMMARY_MAX) return clean;
  return clean.slice(0, SUMMARY_MAX).trimEnd();
}

function clampHighlights(highlights: string[] | undefined): string[] {
  if (!Array.isArray(highlights)) return [];
  return highlights.filter((item) => typeof item === "string" && item.trim()).slice(0, HIGHLIGHTS_MAX);
}

function hasListedPrice(entry: IndexEntry): boolean {
  const price = entry.price;
  return (
    !!price &&
    typeof price.from === "number" &&
    Number.isFinite(price.from) &&
    typeof price.currency === "string" &&
    price.currency.length > 0
  );
}

function priceTableLines(entry: IndexEntry, locale: Locale): string[] {
  const price = entry.price;
  const currency = price?.currency;
  const table = price?.table;
  if (!table || typeof currency !== "string" || !currency) return [];
  const strings = copy[locale];
  const caption = table.caption ?? "";
  const sizes = table.groupSizes ?? [];
  const lines: string[] = [];
  for (const row of table.rows ?? []) {
    const cells = (row.prices ?? []).map((amount, index) => {
      const size = sizes[index] ?? "";
      return `${size}: ${perPerson(locale, amount, currency)}`;
    });
    const supplement = row.singleSupplement ?? "";
    lines.push(
      `${strings.priceTableLabel} (${caption}): ${row.label ?? ""} — ${cells.join("; ")}; ${strings.singleSupplement} ${supplement} ${currency}`,
    );
  }
  return lines;
}

function serializeContext(entries: IndexEntry[], locale: Locale): string {
  if (entries.length === 0) return "(empty)";
  return entries
    .map((entry, index) => {
      const highlights = clampHighlights(entry.highlights);
      const parts = [
        `title: ${entry.title}`,
        `url: ${entry.url}`,
        `summary: ${clampSummary(entry.summary)}`,
      ];
      if (typeof entry.durationDays === "number") parts.push(`duration: ${entry.durationDays}`);
      if (highlights.length > 0) parts.push(`highlights: ${highlights.join("; ")}`);
      if (entry.priceText) parts.push(`price: ${entry.priceText}`);
      parts.push(...priceTableLines(entry, locale));
      return `[${index + 1}] ${parts.join(" | ")}`;
    })
    .join("\n");
}

/** Questions about who runs the trips, middlemen, or which company operates them. Only these get the aboutUs sentence. */
const WHO_RUNS_QUESTION =
  /who\s+(?:runs|operates|organi[sz]es|arranges|is behind)|middle\s*man|reseller|which\s+(?:local\s+)?company|operat(?:es|ed|or|ing)\b|wer\s+(?:führt|organisiert|veranstaltet|steckt)|vermittler|welche[sm]?\s+(?:lokale\s+)?(?:unternehmen|firma)|veranstalt|qui\s+(?:organise|gère|opère)|interm[ée]diaire|quelle\s+(?:entreprise|société)|qui[ée]n\s+(?:organiza|opera|gestiona)|intermediario|qu[ée]\s+empresa|誰が|運営|仲介|どこの会社|どの会社/iu;

function systemPrompt(
  locale: Locale,
  context: string,
  priceAsked: boolean,
  listedPrice: boolean,
  whoRunsAsked = false,
): string {
  const language = copy[locale].languageName;
  const { aboutUs, finalPrice } = copy[locale];
  const lines = [
    "You are the assistant of Sunday Atlas Travel, a travel company that plans and arranges tour packages and tailor-made trips itself.",
    "You are an automated assistant, not a live person. Never claim a human is chatting or will join. Our team replies to inquiries by email. Our only public email address is contact@sundayatlastravel.com; never give any other email address.",
    "Answer ONLY from the CONTEXT block.",
    `Reply ONLY in ${language}, even if the question is in another language.`,
    "Sunday Atlas Travel may be described as a travel agency or travel company. Never describe it as a reseller or middleman, and never mention or name any other company. We plan the trip and arrange the hotels, transport and guides.",
    "Never invent prices, price numbers, dates, departures, availability, or visa rules.",
    `Quote prices ONLY exactly as written in CONTEXT. Write each per-person amount exactly in the form shown in CONTEXT (for example: ${perPerson(locale, "3490", "USD")}). Use the season, group-size, and hotel-class labels as written in CONTEXT, in the reply language.`,
    'When the visitor gives a group size and a hotel class, give the exact matching table cell. Read the column and the row from the labels in CONTEXT (2 people is the column that covers 2; 4* is the row for that hotel class).',
    `Never compute totals, sums for a group, discounts, conversions, averages, or any number not literally in CONTEXT. If asked for a total, give the per-person figure. Whenever you say that the final price is confirmed, use this sentence exactly: "${finalPrice}"`,
    "If the package in CONTEXT has an on-request price, or no package in CONTEXT matches, give no number and offer the inquiry form.",
    "Do not promise response times or turnaround times unless they appear verbatim in CONTEXT.",
    `If the answer is not in CONTEXT or you are unsure, say so and invite the visitor to the inquiry form at /${locale}/contact/ to leave their name and email, or to write to contact@sundayatlastravel.com.`,
    "Keep answers under 120 words. Plain text only. Do not use markdown links or URLs.",
  ];
  if (whoRunsAsked) {
    lines.push(
      `The visitor is asking who runs the trips. Answer with this sentence: "${aboutUs}" Describe only what Sunday Atlas Travel does; do not list what it is not.`,
    );
  } else {
    lines.push("Do not describe who runs or arranges the trips unless the visitor asks; answer only the question asked.");
  }
  if (priceAsked && listedPrice) {
    lines.push(
      `The visitor is asking about price. Quote the listed figures from CONTEXT exactly, in the per-person form shown there (for example: ${perPerson(locale, "3490", "USD")}).`,
    );
  } else if (priceAsked) {
    lines.push(
      "The visitor is asking about price. The price is not listed and is on request. Do not give any number.",
    );
  }
  lines.push("", "CONTEXT:", context);
  return lines.join("\n");
}

function numberValue(token: string): number | null {
  const digits = token.replace(/[.,\u00A0\u202F ]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const match of text.normalize("NFKC").matchAll(new RegExp(NUMBER_TOKEN, "g"))) {
    const value = numberValue(match[0]);
    if (value !== null) out.push(value);
  }
  return out;
}

function currencyNumbers(text: string): number[] {
  const re = new RegExp(`(?:${CURRENCY_UNIT})\\s*(${NUMBER_TOKEN})|(${NUMBER_TOKEN})\\s*(?:${CURRENCY_UNIT})`, "giu");
  const out: number[] = [];
  for (const match of text.normalize("NFKC").matchAll(re)) {
    const value = numberValue(match[1] || match[2] || "");
    if (value !== null) out.push(value);
  }
  return out;
}

/**
 * True when `reply` states a figure the retrieved context does not list.
 * The reply is normalized with NFKC. Comma, dot, space, NBSP, and narrow NBSP
 * are thousands separators between digit groups of three ("6,964", "6 964", "6.964").
 * Unsafe when any number >= 100 is missing from `context`, or when a currency
 * amount ($ € ¥ £ USD EUR GBP JPY CHF 円 ドル, before or after the number) is missing.
 */
export function unsafeAmounts(reply: string, context: string): boolean {
  const allowed = new Set(numbersIn(context));
  for (const value of numbersIn(reply)) {
    if (value >= 100 && !allowed.has(value)) return true;
  }
  for (const value of currencyNumbers(reply)) {
    if (!allowed.has(value)) return true;
  }
  return false;
}

/** Up to two matched packages, each as `title: priceText`, then the contact sentence. */
function listedPriceReply(matched: IndexEntry[], contactOffer: string): string | null {
  const lines: string[] = [];
  for (const entry of matched) {
    if (!hasListedPrice(entry) || !entry.title || !entry.priceText) continue;
    lines.push(`${entry.title}: ${entry.priceText}`);
    if (lines.length === 2) break;
  }
  if (lines.length === 0) return null;
  return `${lines.join("\n")}\n${contactOffer}`;
}

/**
 * Replies must not suggest that someone else runs the trips. Any reply with this
 * wording, in any of the five locales, is replaced with the localized aboutUs text.
 */
const BRAND_WORDING =
  /(?<![\p{L}])partners?(?![\p{L}])|partnerunternehmen|partenaires?|socios? locales?|local\s+(?:tour\s+)?operators?|lokale[nrm]?\s+(?:veranstalter|anbieter)|veranstalter vor ort|op[ée]rateurs? locaux?|op[ée]rateur local|operadore?s? locales?|third[\s-]*part|drittanbieter|(?<![\p{L}])tiers(?![\p{L}])|terceros|middle\s*m[ae]n|mittelsm|vermittler|interm[ée]diaire|intermediari[oa]s?|resellers?|wiederverk[äa]uf|revendeur|revendedor|suppliers?|lieferant|zulieferer|fournisseurs?|proveedor|代理店|仲介|提携|現地パートナー|現地の(?:旅行)?会社/iu;

/** Drop only the sentences that mention another company; keep the rest of the answer. */
export function stripOtherCompanySentences(reply: string): string {
  const sentences = reply.match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n+|$)/gu) ?? [reply];
  return sentences
    .filter((sentence) => !BRAND_WORDING.test(sentence))
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** A frequent model slip in German price confirmations. */
function fixGerman(reply: string, locale: Locale): string {
  if (locale !== "de") return reply;
  return reply.replace(/die endgültigen? Preise?(?= per E-Mail)/g, "den endgültigen Preis");
}

function linksFrom(entries: IndexEntry[], locale: Locale): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.title || !entry.url || seen.has(entry.url)) continue;
    if (!entry.url.startsWith(`/${locale}/`)) continue;
    seen.add(entry.url);
    links.push({ title: entry.title, url: entry.url });
  }
  return links.slice(0, LINK_MATCHES);
}

function withContact(links: Link[], locale: Locale): Link[] {
  const contact = contactLink(locale);
  const rest = links.filter((link) => link.url !== contact.url).slice(0, LINK_MATCHES);
  return [...rest, contact];
}

function mentionsContact(reply: string, locale: Locale): boolean {
  const haystack = reply.toLowerCase();
  if (haystack.includes(`/${locale}/contact`)) return true;
  return haystack.includes(copy[locale].contactOffer.toLowerCase());
}

function selectModel(request: Request, env: Env): string {
  const override = env.CHAT_MODEL_OVERRIDE?.trim() ?? "";
  if (override && isLoopback(request)) return override;
  return CHAT_MODEL;
}

function bindingFor(request: Request, env: Env): AiBinding | null {
  // Mock only on loopback. `wrangler pages dev` also injects the [ai] binding
  // from wrangler.toml, so CHAT_MOCK_AI=1 must win there or the harness would
  // call the account's Workers AI. Any other hostname ignores the flag.
  if (env.CHAT_MOCK_AI === "1" && isLoopback(request)) return mockAi;
  if (env.AI) return env.AI;
  return null;
}

/** Localized "see the price table on the tour page" sentence, with a closing period. */
function seePriceTable(locale: Locale, url: string): string {
  const text = copy[locale].seePriceTable.replaceAll("{url}", url);
  if (/[.。]$/u.test(text)) return text;
  return `${text}${locale === "ja" ? "。" : "."}`;
}

/**
 * Page copy says "see the table below". The chat has no table under the reply,
 * so point at the tour page. The same idea in any of the five locales is covered,
 * including the shorter leftovers "see the table", "Tabelle unten", "ci-dessous",
 * "下の料金表", and "tabla de abajo".
 */
function rewordTableBelow(reply: string, locale: Locale, matched: IndexEntry[]): string {
  const priced = matched.find((entry) => hasListedPrice(entry) && typeof entry.url === "string" && entry.url);
  const pointer = priced?.url ? seePriceTable(locale, priced.url) : "";
  // Say it once: when the reply already points at the tour page, just drop the leftover phrase.
  const replacement = pointer && reply.includes(pointer.replace(/[.。]$/u, "")) ? "" : pointer;
  const phrase = [
    String.raw`see the table(?:\s+below)?`,
    String.raw`(?:siehe\s+(?:die\s+)?)?Tabelle unten`,
    String.raw`(?:voir\s+le\s+tableau\s+)?ci-dessous`,
    String.raw`下の料金表(?:をご覧ください)?`,
    String.raw`(?:vea\s+la\s+)?tabla de abajo`,
  ].join("|");
  const re = new RegExp(String.raw`(\s*[;；]\s*|\s*、\s*)?(?:${phrase})\s*[.。]?`, "giu");
  const next = reply.replace(re, (_full, sep: string | undefined) => {
    if (!replacement) return "";
    if (sep && /[;；、]/.test(sep)) {
      const mark = sep.includes("、") ? "、" : sep.includes("；") ? "；" : ";";
      const lead = /^\s/u.test(sep) ? " " : "";
      return `${lead}${mark} ${replacement}`;
    }
    return replacement;
  });
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]*[;；、][ \t]*(?=[.。]|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Models sometimes echo the `[1]` labels from CONTEXT. Those are not part of the answer. */
function stripContextMarkers(reply: string): string {
  return reply
    .replace(/\[\s*\d+\s*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textFromResult(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";
  const response = (result as { response?: unknown }).response;
  if (typeof response === "string") return response.trim();
  if (response && typeof response === "object") {
    const record = response as Record<string, unknown>;
    for (const key of ["response", "content", "text"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return JSON.stringify(response);
  }
  return "";
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function complete(request: Request, env: Env, ai: AiBinding, messages: ChatMessage[]): Promise<string> {
  const result = await withTimeout(
    ai.run(selectModel(request, env), {
      messages,
      max_tokens: MAX_TOKENS,
      temperature: 0.2,
    }),
    AI_TIMEOUT_MS,
  );
  const text = textFromResult(result);
  if (!text) throw new Error("empty");
  return text;
}

function unavailable(locale: Locale, matched: IndexEntry[], origin: string): Response {
  return json(
    {
      reply: copy[locale].unavailable,
      links: withContact(linksFrom(matched, locale), locale),
      error: "unavailable",
    },
    200,
    origin,
  );
}

export async function onRequestOptions(context: EventContext): Promise<Response> {
  const origin = requestOrigin(context.request);
  if (!origin) return json({ error: "forbidden_origin" }, 403, null);
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      vary: "Origin",
    },
  });
}

export async function onRequestPost(context: EventContext): Promise<Response> {
  const { request, env } = context;
  const origin = requestOrigin(request);
  if (!origin) return json({ error: "forbidden_origin" }, 403, null);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid" }, 400, origin);
  }
  if (!body || typeof body !== "object") return json({ error: "invalid" }, 400, origin);

  const record = body as { message?: unknown; locale?: unknown; history?: unknown };
  if (typeof record.message !== "string") return json({ error: "invalid" }, 400, origin);
  const message = record.message.trim();
  if (message.length === 0) return json({ error: "invalid" }, 400, origin);
  if (message.length > MESSAGE_MAX) return json({ error: "message_too_long" }, 400, origin);

  let locale: Locale = "en";
  if (record.locale !== undefined && record.locale !== "") {
    if (!isLocale(record.locale)) return json({ error: "invalid" }, 400, origin);
    locale = record.locale;
  }

  const history = readHistory(record.history);
  const strings = copy[locale];

  if (await rateLimited(request, env)) {
    return json(
      { reply: strings.rateLimited, links: [contactLink(locale)], error: "rate_limited" },
      429,
      origin,
    );
  }

  const index = await loadIndex(request, env, locale);
  const lastUser = [...history].reverse().find((turn) => turn.role === "user")?.content ?? "";
  const matched = topEntries(index, `${message}\n${lastUser}`);
  const priceAsked = PRICE_QUESTION.test(message) || PRICE_QUESTION.test(lastUser);
  const retrieved = serializeContext(matched, locale);
  const listedPrice = matched.some(hasListedPrice);
  const ai = bindingFor(request, env);

  if (!ai) {
    console.warn("AI binding is not available.");
    return unavailable(locale, matched, origin);
  }

  if (await blockedByDailyCap(env)) {
    return json(
      { reply: strings.dailyCap, links: [contactLink(locale)], error: "daily_cap" },
      200,
      origin,
    );
  }

  let reply: string;
  try {
    reply = await complete(request, env, ai, [
      { role: "system", content: systemPrompt(locale, retrieved, priceAsked, listedPrice, WHO_RUNS_QUESTION.test(message)) },
      ...history,
      { role: "user", content: message },
    ]);
  } catch {
    return unavailable(locale, matched, origin);
  }

  reply = fixGerman(rewordTableBelow(stripContextMarkers(reply), locale, matched), locale);
  if (BRAND_WORDING.test(reply)) {
    reply = stripOtherCompanySentences(reply) || `${strings.aboutUs}\n\n${strings.contactOffer}`;
  }
  if (unsafeAmounts(reply, retrieved)) {
    reply = listedPriceReply(matched, strings.contactOffer) ?? strings.priceOnRequest;
  }

  const pageLinks = linksFrom(matched, locale);
  if (pageLinks.length === 0 && !mentionsContact(reply, locale)) {
    reply = `${reply}\n\n${strings.contactOffer}`;
  }

  return json({ reply, links: withContact(pageLinks, locale) }, 200, origin);
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: {
      "content-type": "application/json; charset=utf-8",
      allow: "POST, OPTIONS",
    },
  });
}

/** Method handlers take precedence on Pages. This covers every other method, and also dispatches if the runtime calls onRequest for all methods. */
export async function onRequest(context: EventContext): Promise<Response> {
  const method = context.request.method.toUpperCase();
  if (method === "POST") return onRequestPost(context);
  if (method === "OPTIONS") return onRequestOptions(context);
  return methodNotAllowed();
}
