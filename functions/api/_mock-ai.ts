/**
 * Deterministic stand-in for the Workers AI binding.
 * chat.ts uses this on localhost when CHAT_MOCK_AI is "1", including when
 * wrangler has also injected the AI binding. Replies are built from CONTEXT titles.
 */
import { copy, locales, type Locale } from "./_i18n";

interface ChatMessage {
  role: string;
  content: string;
}

function messagesOf(input: unknown): ChatMessage[] {
  if (!input || typeof input !== "object") return [];
  const messages = (input as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  const out: ChatMessage[] = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    out.push({
      role: typeof role === "string" ? role : "",
      content: typeof content === "string" ? content : "",
    });
  }
  return out;
}

function languageOf(system: string): Locale {
  for (const locale of locales) {
    if (locale !== "en" && system.includes(copy[locale].languageName)) return locale;
  }
  return "en";
}

const PRICE_QUESTION = /price|cost|how much|preis|kostet|料金|いくら|値段/i;

const TABLE_LABEL = /price table|Preistabelle|grille tarifaire|料金表|tabla de precios/i;

function contextOf(system: string): string {
  const marker = "CONTEXT:";
  const index = system.indexOf(marker);
  return index === -1 ? "" : system.slice(index + marker.length);
}

function titlesIn(system: string): string[] {
  const context = contextOf(system);
  if (context.includes("(empty)") && !/title:/.test(context)) return [];
  return [...context.matchAll(/title:\s*([^|\n]+)/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function foundReply(locale: Locale, titles: string[]): string {
  const list = titles.join(", ");
  if (locale === "ja") return `こちらが見つかりました: ${list}。`;
  if (locale === "de") return `Das habe ich gefunden: ${list}.`;
  if (locale === "fr") return `Voici ce que j’ai trouvé : ${list}.`;
  if (locale === "es") return `Esto es lo que encontré: ${list}.`;
  return `Here is what I found: ${list}.`;
}

interface PriceCell {
  groupSize: string;
  /** Amount phrase copied from CONTEXT, for example `1名あたり 6964 USD`. */
  text: string;
}

interface ParsedTable {
  caption: string;
  label: string;
  cells: PriceCell[];
}

function blocks(context: string): { title: string; body: string }[] {
  return context
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("["))
    .map((line) => {
      const title = line.match(/title:\s*([^|]+)/);
      return { title: title ? title[1].trim() : "", body: line };
    })
    .filter((entry) => entry.title);
}

function tablesIn(body: string): ParsedTable[] {
  const out: ParsedTable[] = [];
  const line = new RegExp(String.raw`(?:${TABLE_LABEL.source}) \(([^)]*)\): ([^|\n]+)`, "giu");
  for (const match of body.matchAll(line)) {
    const caption = match[1].trim();
    const rest = match[2].trim();
    const splitAt = rest.indexOf(" — ");
    if (splitAt === -1) continue;
    const label = rest.slice(0, splitAt).trim();
    const cells: PriceCell[] = [];
    for (const bit of rest.slice(splitAt + " — ".length).split(";")) {
      const cell = bit.trim().match(/^(.*?):\s*(.+)$/);
      if (!cell || !/\d/.test(cell[2])) continue;
      cells.push({ groupSize: cell[1].trim(), text: cell[2].trim() });
    }
    out.push({ caption, label, cells });
  }
  return out;
}

function rangeContains(label: string, n: number): boolean {
  const nums = [...label.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (nums.length === 0) return false;
  if (nums.length === 1) return nums[0] === n;
  const lo = Math.min(nums[0], nums[1]);
  const hi = Math.max(nums[0], nums[1]);
  return n >= lo && n <= hi;
}

function groupSizeN(message: string): number | null {
  const named = message.match(/(\d+)\s*(?:people|persons?|travell?ers?|pax|guests?|adults?|名|人|Personen|Reisende)/iu);
  if (named) return Number(named[1]);
  const stripped = message.replace(/\d+\s*\*/g, " ");
  const nums = [...stripped.matchAll(/\d+/g)].map((match) => Number(match[0]));
  return nums.length > 0 ? nums[nums.length - 1] : null;
}

function firstPriceText(context: string): string | null {
  const match = context.match(/(?:^|\|\s*)price:\s*([^|\n]+)/);
  return match ? match[1].trim() : null;
}

function cellReply(title: string, cell: PriceCell, table: ParsedTable): string {
  return `${title}: ${cell.text} (${cell.groupSize}, ${table.label}), ${table.caption}.`;
}

/** `5スタン`, `5つのスタン`, `5 Stans`, or a written-out "four". */
function stanCount(text: string): string | null {
  const ja = text.match(/([1-9])\s*(?:つの)?スタン/u);
  if (ja) return ja[1];
  const latin = text.match(/([1-9])\s*stans/i);
  if (latin) return latin[1];
  if (/\bfour\s+stans\b/i.test(text) || /\bvier\s+stans\b/i.test(text) || text.includes("フォー")) return "4";
  return null;
}

function hotelDigit(message: string): string | null {
  const star = message.match(/([1-5])\s*\*/);
  if (star) return star[1];
  const ja = message.match(/([1-5])\s*つ星/u);
  if (ja) return ja[1];
  return null;
}

function labelMatchesHotel(label: string, digit: string): boolean {
  return label.includes(`${digit}*`) || label.includes(`${digit}つ星`);
}

/** Price question: the matching table cell, copied as written in CONTEXT, or the first `price:` line. */
function priceReply(context: string, message: string): string | null {
  const digit = hotelDigit(message);
  const n = groupSizeN(message);
  if (digit && n != null) {
    const entries = blocks(context);
    const want = stanCount(message);
    const pool = want
      ? entries.filter((entry) => stanCount(`${entry.title}\n${entry.body}`) === want)
      : entries;
    for (const entry of pool.length > 0 ? pool : entries) {
      for (const table of tablesIn(entry.body)) {
        if (!labelMatchesHotel(table.label, digit)) continue;
        const cell = table.cells.find((item) => rangeContains(item.groupSize, n));
        if (!cell) continue;
        return cellReply(entry.title, cell, table);
      }
    }
  }
  return firstPriceText(context);
}

function replyFor(input: unknown): string {
  const messages = messagesOf(input);
  const system = messages.find((message) => message.role === "system")?.content ?? "";
  const user = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  if (user.includes("PRICE_TRAP")) return "It costs $1,999.";
  // Report on the real system prompt; the reply itself carries no brand words or amounts.
  if (user.includes("SHOW_SYSTEM")) {
    const banned = ["partner", "Partner", "local operator", "third part", "Agentur"].filter((word) => system.includes(word));
    const flags = [banned.length === 0 ? "SYSTEM_CLEAN" : `SYSTEM_BANNED_${banned.length}`];
    if (system.includes("den endgültigen Preis")) flags.push("DE_FINAL_PRICE");
    if (system.includes("CONTEXT:")) flags.push("HAS_CONTEXT");
    if (locales.some((locale) => system.includes(copy[locale].aboutUs))) flags.push("HAS_ABOUT_US");
    return flags.join(" ");
  }
  if (user.includes("AGENCY_SELF")) {
    const self: Record<string, string> = {
      en: "Sunday Atlas Travel is a travel agency that plans every trip itself.",
      de: "Sunday Atlas Travel ist ein Reisebüro, das jede Reise selbst plant.",
      fr: "Sunday Atlas Travel est une agence de voyages qui organise chaque voyage elle-même.",
      es: "Sunday Atlas Travel es una agencia de viajes que planifica cada viaje.",
    };
    const loc = languageOf(system);
    return `${self[loc] ?? self.en} Our local partner runs the tours. Prices are listed per person.`;
  }
  if (user.includes("PARTNER_TRAP")) return "We work with a local partner agency that operates the tours.";
  if (user.includes("GRAMMAR_TRAP")) return "Das Team bestätigt die endgültige Preise per E-Mail.";
  if (user.includes("TOTAL_TRAP")) return "The total for 2 people is $13,928.";
  const locale = languageOf(system);
  const context = contextOf(system);
  if (user.includes("TABLE_BELOW")) {
    const price = firstPriceText(context) ?? "";
    return `${price} See the table below.`.trim();
  }
  if (PRICE_QUESTION.test(user) && TABLE_LABEL.test(context)) {
    const priced = priceReply(context, user);
    if (priced) return priced;
  }
  const titles = titlesIn(system);
  if (titles.length === 0) return copy[locale].contactOffer;
  return foundReply(locale, titles);
}

/** Fake `env.AI`. `run` matches the Workers AI binding shape and returns `{ response }`. */
export const mockAi: {
  run(model: string, input: unknown): Promise<{ response: string }>;
} = {
  async run(model, input) {
    const response = replyFor(input);
    return { response: model ? response : response };
  },
};
