/**
 * Chat API checks against a local Pages dev server. No extra dependencies.
 * BASE defaults to http://127.0.0.1:8788.
 * The rate-limit case expects at least one 429. Set REQUIRE_RL=0 to skip that
 * assertion when CHAT_RL is not bound.
 * The daily-cap case only checks that the source wires the counter. It does not
 * need KV or 800 requests.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.BASE || "http://127.0.0.1:8788").replace(/\/$/, "");
const origin = "http://127.0.0.1:8788";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "de", "fr", "ja", "es"];
const PACKAGE_SLUGS = [
  "3-stans-discovery-14-days",
  "four-stans-odyssey-18-days",
  "five-stans-long-road-22-days",
];
const DRAFT_NEEDLES = ["bhutan", "bhutan-7-day-cultural-journey", "kyrgyzstan-8-day-nomad-trails"];

const CURRENCY =
  /(?:[$€¥£]\s?\d)|(?:\d[\d.,]*\s?[$€¥£])|(?:\d[\d.,]*\s*(?:USD|EUR|GBP|JPY|CHF|円))|(?:(?:USD|EUR|GBP|JPY|CHF)\s*\d)/i;

let failed = 0;

function record(name, ok, detail) {
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${suffix}`);
  if (!ok) failed += 1;
}

let sent = 0;
const RUN_SALT = Math.floor(Math.random() * 250);
/** Ten requests per fake client IP, so the suite stays under the per-IP window except in the rate-limit case. */
async function post(body, { originHeader = origin, method = "POST", ip = `10.${RUN_SALT}.${Math.floor(sent++ / 10)}.1` } = {}) {
  const response = await fetch(`${base}/api/chat`, {
    method,
    headers: {
      origin: originHeader,
      "cf-connecting-ip": ip,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

function linksOf(json) {
  if (!json || !Array.isArray(json.links)) return [];
  return json.links.filter((link) => link && typeof link.url === "string");
}

function urlsOf(json) {
  return linksOf(json).map((link) => link.url);
}

function hasUrl(json, fragment) {
  return urlsOf(json).some((url) => url.includes(fragment));
}

function dailyCapWired() {
  const chat = readFileSync(join(root, "functions/api/chat.ts"), "utf8");
  const i18n = readFileSync(join(root, "functions/api/_i18n.ts"), "utf8");
  const handler = chat.slice(chat.indexOf("export async function onRequestPost"));
  const exportOk = chat.includes("export const DAILY_CHAT_CAP = 800;");
  const keyOk = chat.includes("cap:${");
  const capAt = handler.indexOf("blockedByDailyCap");
  const aiAt = handler.indexOf("complete(");
  const beforeAi = capAt !== -1 && aiAt !== -1 && capAt < aiAt;
  const copyCount = (i18n.match(/dailyCap: "/g) || []).length;
  return exportOk && keyOk && beforeAi && copyCount === 5;
}

async function main() {
  record(
    "daily cap source",
    dailyCapWired(),
    "DAILY_CHAT_CAP, cap:{YYYY-MM-DD}, check before the model, dailyCap in five locales",
  );

  const en = await post({ message: "Tell me about the 5 Stans tour", locale: "en" });
  record(
    "en 5 Stans links",
    en.status === 200 && hasUrl(en.json, "/en/packages/five-stans-long-road-22-days/"),
    `status ${en.status} links ${urlsOf(en.json).join(", ")}`,
  );

  const ja = await post({ message: "3スタンのツアーについて教えて", locale: "ja" });
  record(
    "ja 3 Stans links",
    ja.status === 200 && hasUrl(ja.json, "/ja/packages/3-stans-discovery-14-days/"),
    `status ${ja.status} links ${urlsOf(ja.json).join(", ")}`,
  );

  const jaTour = await post({ message: "カザフスタンのツアーについて教えて", locale: "ja" });
  const jaTourUrls = urlsOf(jaTour.json);
  record(
    "ja bigrams",
    jaTour.status === 200 &&
      jaTourUrls.some((url) => url.includes("/ja/destinations/kazakhstan/")) &&
      jaTourUrls.some((url) => url.includes("/ja/packages/3-stans-discovery-14-days/")),
    `status ${jaTour.status} links ${jaTourUrls.join(", ")}`,
  );

  const missing = await post({ message: "Antarctica cruise", locale: "en" });
  const missingLinks = linksOf(missing.json);
  const contact = missingLinks.some((link) => link.url.includes("/en/contact"));
  const offer = typeof missing.json?.reply === "string" && /contact|inquiry form/i.test(missing.json.reply);
  record(
    "nonexistent tour offers contact",
    missing.status === 200 && (contact || offer),
    `status ${missing.status} reply ${(missing.json?.reply || "").slice(0, 120)}`,
  );

  const cell = await post({ message: "how much is the 5 stans tour for 2 people 4*?", locale: "en" });
  const cellReply = typeof cell.json?.reply === "string" ? cell.json.reply : "";
  record(
    "exact price cell",
    cell.status === 200 && cellReply.includes("6964") && cellReply.includes("USD") && /per person/i.test(cellReply),
    cellReply.slice(0, 200),
  );

  const jaCell = await post({ message: "5スタンのツアーは2名、4つ星でいくらですか？", locale: "ja" });
  const jaCellReply = typeof jaCell.json?.reply === "string" ? jaCell.json.reply : "";
  record(
    "ja per-person localized",
    jaCell.status === 200 && jaCellReply.includes("1名あたり") && jaCellReply.includes("6964"),
    jaCellReply.slice(0, 220),
  );

  const deCell = await post({ message: "Was kostet die 5 Stans Reise für 2 Personen 4*?", locale: "de" });
  const deCellReply = typeof deCell.json?.reply === "string" ? deCell.json.reply : "";
  record(
    "de per-person localized",
    deCell.status === 200 && deCellReply.includes("pro Person") && deCellReply.includes("6964"),
    deCellReply.slice(0, 220),
  );

  const fromPrice = await post({ message: "What is the price of the 3 Stans tour?", locale: "en" });
  const fromReply = typeof fromPrice.json?.reply === "string" ? fromPrice.json.reply : "";
  record(
    "from price kept",
    fromPrice.status === 200 && fromReply.includes("2643"),
    fromReply.slice(0, 200),
  );

  const trap = await post({ message: "PRICE_TRAP 5 Stans tour", locale: "en" });
  const trapReply = typeof trap.json?.reply === "string" ? trap.json.reply : "";
  record(
    "invented price stripped",
    trap.status === 200 && !trapReply.includes("1999") && !trapReply.includes("1,999") && trapReply.includes("3490"),
    trapReply.slice(0, 200),
  );

  const total = await post({ message: "TOTAL_TRAP 5 Stans tour for 2 people 4*", locale: "en" });
  const totalReply = typeof total.json?.reply === "string" ? total.json.reply : "";
  record(
    "computed total stripped",
    total.status === 200 && !totalReply.includes("13928") && !totalReply.includes("13,928"),
    totalReply.slice(0, 200),
  );

  const unlisted = await post({ message: "How much is the Antarctica penguin cruise?", locale: "en" });
  const unlistedReply = typeof unlisted.json?.reply === "string" ? unlisted.json.reply : "";
  const unlistedContact =
    hasUrl(unlisted.json, "/en/contact") || /contact|inquiry form/i.test(unlistedReply);
  record(
    "no price for unlisted tour",
    unlisted.status === 200 && !CURRENCY.test(unlistedReply) && unlistedContact,
    unlistedReply.slice(0, 200),
  );

  let draftsOk = true;
  let draftsDetail = "";
  try {
    for (const locale of LOCALES) {
      const response = await fetch(`${base}/chat-index/${locale}.json`);
      if (!response.ok) throw new Error(`${locale} status ${response.status}`);
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error(`${locale} is not a list`);
      const leaked = entries.some((entry) => {
        const id = entry && typeof entry.id === "string" ? entry.id : "";
        const url = entry && typeof entry.url === "string" ? entry.url : "";
        return DRAFT_NEEDLES.some((needle) => id.includes(needle) || url.includes(needle));
      });
      const present = PACKAGE_SLUGS.every((slug) =>
        entries.some((entry) => entry && typeof entry.url === "string" && entry.url.includes(`/${locale}/packages/${slug}/`)),
      );
      if (leaked || !present) {
        draftsOk = false;
        draftsDetail = `${locale} leaked=${leaked} present=${present}`;
        break;
      }
    }
  } catch (error) {
    draftsOk = false;
    draftsDetail = error instanceof Error ? error.message : String(error);
  }
  record("drafts excluded from index", draftsOk, draftsDetail);

  let tableOk = false;
  let tableDetail = "";
  try {
    const response = await fetch(`${base}/chat-index/en.json`);
    if (!response.ok) throw new Error(`en index status ${response.status}`);
    const entries = await response.json();
    const entry = Array.isArray(entries)
      ? entries.find((item) => item && typeof item.url === "string" && item.url.includes("/en/packages/five-stans-long-road-22-days/"))
      : null;
    const pkg = JSON.parse(readFileSync(join(root, "content/packages/five-stans-long-road-22-days.json"), "utf8"));
    const rows = entry?.price?.table?.rows;
    const srcRows = pkg?.priceTable?.rows;
    tableOk =
      Array.isArray(rows) &&
      Array.isArray(srcRows) &&
      rows.length === srcRows.length &&
      rows.every((row, i) => {
        const src = srcRows[i];
        if (!src || row.singleSupplement !== src.singleSupplement) return false;
        const prices = row.prices;
        const srcPrices = src.prices;
        if (!Array.isArray(prices) || !Array.isArray(srcPrices) || prices.length !== srcPrices.length) return false;
        return prices.every((price, j) => price === srcPrices[j]);
      });
    if (!tableOk) tableDetail = `rows ${Array.isArray(rows) ? rows.length : "missing"}`;
  } catch (error) {
    tableDetail = error instanceof Error ? error.message : String(error);
  }
  record("index price table exact", tableOk, tableDetail);

  const bannedTable = ["see the table below", "Tabelle unten", "ci-dessous", "下の料金表をご覧ください", "tabla de abajo"];
  let wordingOk = false;
  let wordingDetail = "";
  try {
    const indexes = {};
    for (const locale of LOCALES) {
      const response = await fetch(`${base}/chat-index/${locale}.json`);
      if (!response.ok) throw new Error(`${locale} status ${response.status}`);
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error(`${locale} is not a list`);
      indexes[locale] = entries;
      const stale = entries.find((entry) => {
        const text = entry && typeof entry.priceText === "string" ? entry.priceText : "";
        const haystack = text.toLowerCase();
        return bannedTable.some((phrase) => haystack.includes(phrase.toLowerCase()));
      });
      if (stale) throw new Error(`${locale} priceText still points below the reply`);
    }
    const fr = indexes.fr.find(
      (item) => item && typeof item.url === "string" && item.url.includes("/fr/packages/five-stans-long-road-22-days/"),
    );
    const es = indexes.es.find(
      (item) => item && typeof item.url === "string" && item.url.includes("/es/packages/five-stans-long-road-22-days/"),
    );
    wordingOk =
      typeof fr?.priceText === "string" &&
      fr.priceText.includes("page du circuit") &&
      fr.priceText.includes("/fr/packages/five-stans-long-road-22-days/") &&
      typeof es?.priceText === "string" &&
      es.priceText.includes("página del tour") &&
      es.priceText.includes("/es/packages/five-stans-long-road-22-days/");
    if (!wordingOk) {
      wordingDetail = `fr ${(fr?.priceText || "").slice(0, 180)} | es ${(es?.priceText || "").slice(0, 180)}`;
    }
  } catch (error) {
    wordingDetail = error instanceof Error ? error.message : String(error);
  }
  record("fr/es index wording", wordingOk, wordingDetail);

  const tableBelow = await post({ message: "TABLE_BELOW 5 Stans tour", locale: "en" });
  const tableBelowReply = typeof tableBelow.json?.reply === "string" ? tableBelow.json.reply : "";
  record(
    "table below reworded",
    tableBelow.status === 200 &&
      !/table below/i.test(tableBelowReply) &&
      tableBelowReply.includes("/en/packages/five-stans-long-road-22-days/"),
    tableBelowReply.slice(0, 240),
  );

  const jaTrap = await post({ message: "PRICE_TRAP 5スタン", locale: "ja" });
  const jaTrapReply = typeof jaTrap.json?.reply === "string" ? jaTrap.json.reply : "";
  const jaFromLabel = "1名あたり$3490から（10～11名、3つ星）";
  record(
    "guard fallback localized",
    jaTrap.status === 200 &&
      (jaTrapReply.includes("1名あたり") || jaTrapReply.includes(jaFromLabel)) &&
      !jaTrapReply.includes("1999") &&
      !/below/i.test(jaTrapReply),
    jaTrapReply.slice(0, 240),
  );

  for (const locale of ["en", "de"]) {
    const sys = await post({ message: "SHOW_SYSTEM 5 Stans", locale });
    const flags = typeof sys.json?.reply === "string" ? sys.json.reply : "";
    record(
      `${locale} system prompt has no partner/agency wording`,
      sys.status === 200 &&
        flags.includes("SYSTEM_CLEAN") &&
        flags.includes("HAS_CONTEXT") &&
        (locale !== "de" || flags.includes("DE_FINAL_PRICE")),
      flags,
    );
  }

  const aboutCases = [
    ["de", "SHOW_SYSTEM Was kostet die 5 Stans Reise für 2 Personen mit 4*-Hotels insgesamt?", false],
    ["en", "SHOW_SYSTEM How much is the 5 stans tour for 2 people 4*?", false],
    ["en", "SHOW_SYSTEM are you a middleman?", true],
    ["de", "SHOW_SYSTEM Wer führt Ihre Reisen durch?", true],
  ];
  for (const [locale, message, expected] of aboutCases) {
    const result = await post({ message, locale });
    const flags = typeof result.json?.reply === "string" ? result.json.reply : "";
    record(
      `aboutUs only for who-runs (${locale}: ${message.slice(12, 40)})`,
      result.status === 200 && flags.includes("HAS_ABOUT_US") === expected,
      flags,
    );
  }

  const selfLines = {
    en: "Sunday Atlas Travel is a travel agency that plans every trip itself.",
    de: "Sunday Atlas Travel ist ein Reisebüro, das jede Reise selbst plant.",
    fr: "Sunday Atlas Travel est une agence de voyages qui organise chaque voyage elle-même.",
    es: "Sunday Atlas Travel es una agencia de viajes que planifica cada viaje.",
  };
  const filterQuestions = {
    en: ["how much does a tour cost?", "is a travel agency worth it?"],
    de: ["Wie viel kostet eine Reise?", "Lohnt sich ein Reisebüro?"],
    fr: ["Combien coûte un circuit ?", "Est-ce qu'une agence de voyages vaut le coup ?"],
    es: ["¿Cuánto cuesta un tour?", "¿Vale la pena una agencia de viajes?"],
  };
  for (const [locale, questions] of Object.entries(filterQuestions)) {
    for (const question of questions) {
      const result = await post({ message: `AGENCY_SELF ${question}`, locale });
      const text = typeof result.json?.reply === "string" ? result.json.reply : "";
      record(
        `filter keeps self-description, strips partner sentence (${locale}: ${question})`,
        result.status === 200 &&
          text.includes(selfLines[locale]) &&
          !/partner/i.test(text) &&
          text.includes("Prices are listed per person."),
        text.slice(0, 200),
      );
    }
  }

  const partner = await post({ message: "PARTNER_TRAP who runs the 5 Stans tour?", locale: "de" });
  const partnerReply = typeof partner.json?.reply === "string" ? partner.json.reply : "";
  record(
    "partner wording replaced",
    partner.status === 200 &&
      !/partner|agenc|agentur|operat|veranstalter/i.test(partnerReply) &&
      partnerReply.includes("plant jede Reise selbst"),
    partnerReply.slice(0, 160),
  );

  const grammar = await post({ message: "GRAMMAR_TRAP 5 Stans", locale: "de" });
  const grammarReply = typeof grammar.json?.reply === "string" ? grammar.json.reply : "";
  record(
    "de final price grammar",
    grammar.status === 200 && grammarReply.includes("den endgültigen Preis") && !grammarReply.includes("die endgültige Preise"),
    grammarReply.slice(0, 160),
  );

  const bhutan = await post({ message: "Tell me about Bhutan", locale: "en" });
  record(
    "Bhutan gets no draft link",
    bhutan.status === 200 && !urlsOf(bhutan.json).some((url) => url.toLowerCase().includes("bhutan")),
    `status ${bhutan.status} links ${urlsOf(bhutan.json).join(", ")}`,
  );

  const evil = await post({ message: "5 Stans", locale: "en" }, { originHeader: "https://evil.example" });
  record(
    "forbidden origin",
    evil.status === 403 && evil.json?.error === "forbidden_origin",
    `status ${evil.status} error ${evil.json?.error}`,
  );

  const long = await post({ message: "a".repeat(501), locale: "en" });
  record(
    "message too long",
    long.status === 400 && long.json?.error === "message_too_long",
    `status ${long.status} error ${long.json?.error}`,
  );

  const preflight = await fetch(`${base}/api/chat`, {
    method: "OPTIONS",
    headers: { origin, "access-control-request-method": "POST" },
  });
  const allowOrigin = preflight.headers.get("access-control-allow-origin");
  const allowMethods = preflight.headers.get("access-control-allow-methods") || "";
  record(
    "OPTIONS preflight",
    preflight.status === 204 && allowOrigin === origin && /POST/i.test(allowMethods) && /OPTIONS/i.test(allowMethods),
    `status ${preflight.status} allow-origin ${allowOrigin} allow-methods ${allowMethods}`,
  );

  let limited = null;
  for (let i = 0; i < 22; i += 1) {
    const result = await post({ message: `5 Stans window check ${i}`, locale: "en" }, { ip: `10.${RUN_SALT}.250.9` });
    if (result.status === 429) {
      limited = result;
      break;
    }
  }
  if (limited) {
    const reply = typeof limited.json?.reply === "string" ? limited.json.reply : "";
    const contactLink = linksOf(limited.json).some((link) => link.url.includes("/en/contact"));
    record(
      "rate limit",
      limited.json?.error === "rate_limited" && reply.length > 0 && contactLink,
      `status ${limited.status} error ${limited.json?.error}`,
    );
  } else if (process.env.REQUIRE_RL === "0") {
    console.log("SKIP rate limit — no 429 in 22 requests (REQUIRE_RL=0)");
  } else {
    record("rate limit", false, "no 429 in 22 requests (set REQUIRE_RL=0 if CHAT_RL is unbound)");
  }

  if (failed > 0) {
    console.log(`${failed} failed`);
    process.exit(1);
  }
  console.log("all passed");
}

main().catch((error) => {
  console.log(`FAIL harness — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
