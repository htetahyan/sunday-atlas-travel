/**
 * Machine-translation checks. No server and no network unless BASE is set.
 * BASE (a `wrangler pages dev` origin) also checks POST /api/translate.
 */
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAutoTranslate } from "./auto-translate.mjs";
import {
  collectFields,
  NEURON_RATES,
  TRANSLATE_MODEL,
  canonicalJson,
  decideStatus,
  estimateNeurons,
  hashCanonical,
  numberMultiset,
  packBatches,
  validateTranslation,
  numbersPreserved,
  hasGenderForm,
  buildSystemPrompt,
} from "./lib/auto-translate-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const realPackage = join(root, "content", "packages", "3-stans-discovery-14-days.json");
const COPY =
  "Day **note** trip\n# Ridge\n- walk\nSee [map](https://res.cloudinary.com/demo/image/upload/v1/a.jpg) and /en/packages/sample/ for $10 or 10.5 km. {who} {{x}} %s <br> 4*";

let failed = 0;

function record(name, ok, detail) {
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${suffix}`);
  if (!ok) failed += 1;
}

{
  const en = "This tour is a private 2-day trip from Almaty for one to six travellers. Day one walks the canyon; about 5 hours on the road each day.";
  const ja = "アルマトイ発の2日間のプライベートツアーで、1人から6人まで参加できます。1日目は峡谷を歩き、1日あたり約5時間車に乗ります。";
  record("ja counters for number words pass", numbersPreserved(en, ja));
  record("4x4 → 4WD passes", numbersPreserved("4x4 taxi to Kaindy Lake where needed", "必要に応じてカインディ湖への4WDタクシー。"));
  record("ja months as numbers pass", numbersPreserved("Early June to mid-September; a harder winter version may run from December to February", "6月初旬から9月中旬まで。冬のハードなバージョンは12月から2月まで開催される場合があります。"));
  for (const bad of ["$1092 für eine*n Reisende*n", "1 Reisende*r", "unsere Guide:innen", "alle Gäste_innen", "Teilnehmer*innen"]) {
    record(`de gender form flagged: ${bad}`, hasGenderForm(bad, "de") && validateTranslation("$1092 for one traveller", bad.includes("1092") ? bad : `$1092 ${bad}`, "de").reasons.includes("gender-star form"));
  }
  for (const ok of ["$1092 für Alleinreisende", "4–6 Gäste", "Wandern: etwa 1 Stunde", "**Hinweis:** bitte", "Sterne 3* und 4*", "https://res.cloudinary.com/a/b_c/x*y.jpg"]) {
    record(`de neutral wording passes: ${ok}`, !hasGenderForm(ok, "de"));
  }
  record("fr middle-dot form flagged", hasGenderForm("les voyageur·euses", "fr") && !hasGenderForm("les voyageurs", "fr"));
  record("prompt has neutral-plural, place-name and species rules", (() => {
    const p = buildSystemPrompt("de", "translate");
    return p.includes("neutral plural nouns") && p.includes("one form for each place name") && p.includes("spruce") && p.includes("Fichte");
  })());
  record("changed price fails", !numbersPreserved("from $468 per person", "1人あたり$486から"));
  record("dropped number fails", !numbersPreserved("$468 for 4–6 travellers", "$468"));
  record("invented large number fails", !numbersPreserved("per person", "1人あたり 2026"));
  record("extra counters without number words fail", !numbersPreserved("Season 2026", "2026年 3日"));
  const usd = validateTranslation("Season 2026, USD per person", "2026年シーズン、1人あたりの米ドル価格", "ja");
  record("ja 米ドル counts as USD", usd.ok !== false && !(usd.reasons || []).length, JSON.stringify(usd));
}

function writeDoc(cwd, rel, doc) {
  const file = join(cwd, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return file;
}

function readDoc(cwd, rel) {
  return JSON.parse(readFileSync(join(cwd, rel), "utf8"));
}

function tempProject() {
  const cwd = mkdtempSync(join(tmpdir(), "auto-translate-"));
  mkdirSync(join(cwd, "content", "packages"), { recursive: true });
  mkdirSync(join(cwd, "content", "destinations"), { recursive: true });
  mkdirSync(join(cwd, "content", "pages"), { recursive: true });
  return cwd;
}

function sampleDoc() {
  return {
    slug: "sample",
    durationDays: 14,
    title: { en: "Almaty from $10", de: "", fr: "", ja: "", es: "" },
    summary: {
      en: COPY,
      de: "",
      fr: "Déjà traduit",
      ja: "",
      es: "",
    },
    included: { en: ["Hotel for 2", "Guide"], de: [], fr: [], ja: [], es: [] },
    style: { en: "Mountains", de: "Berge", fr: "Montagnes", ja: "山", es: "Montañas" },
    seo: {
      en: {
        seo_title: "Sample tour from $10",
        meta_description: "A sample for 2 travellers.",
        focus_keyword: "sample tour",
        keywords: ["sample tour", "almaty"],
        og_image: "https://res.cloudinary.com/demo/og.jpg",
        canonical: "/en/packages/sample/",
        noindex: false,
      },
      de: {
        seo_title: "",
        meta_description: "",
        focus_keyword: "",
        keywords: [],
        og_image: "https://res.cloudinary.com/demo/og.jpg",
        canonical: "/en/packages/sample/",
        noindex: true,
      },
    },
  };
}

function unitChecks() {
  const objectA = canonicalJson({ b: 1, a: ["x"] });
  const objectB = canonicalJson({ a: ["x"], b: 1 });
  record("canonical key order", objectA === objectB && objectA === '{"a":["x"],"b":1}');
  record("hash stable", hashCanonical("Almaty") === hashCanonical("Almaty") && hashCanonical("Almaty").length === 64);

  record("empty english skips", decideStatus("", "etwas", null, "de") === "skip");
  record("empty target is missing", decideStatus("Hello", "", null, "de") === "missing");
  record("whitespace target is missing", decideStatus("Hello", "  ", null, "de") === "missing");
  record("blank list is missing", decideStatus(["Hello"], ["  "], null, "de") === "missing");
  record("no sidecar is human", decideStatus("Hello", "Hallo", null, "de") === "human");

  const english = "Hello";
  const translated = "Hallo";
  const current = { src: hashCanonical(english), de: hashCanonical(translated) };
  record("matching sidecar is current", decideStatus(english, translated, current, "de") === "current");
  record(
    "english change is stale",
    decideStatus("Hello!", translated, current, "de") === "stale",
  );
  record(
    "edited translation is human",
    decideStatus(english, "Hallo Leute", current, "de") === "human",
  );

  record("numbers 6,964 and 6964", numberMultiset("pay 6,964") .join() === numberMultiset("pay 6964").join());
  record("numbers 10.5 and 10,5", numberMultiset("10.5 km").join() === numberMultiset("10,5 km").join());
  record(
    "numbers keep separate values",
    numberMultiset("14 days and 13 nights").join() === "13,14",
  );

  const rich = COPY;
  const richDe = rich.replace("/en/", "/de/");
  record("rich translation passes", validateTranslation(rich, richDe, "de").ok, validateTranslation(rich, richDe, "de").reasons.join(", "));
  record("self-description as travel agency passes (de)", validateTranslation("We are a travel agency.", "Wir sind ein Reisebüro und eine Reiseagentur.", "de").ok);
  record("self-description as travel agency passes (fr)", validateTranslation("We are a travel agency.", "Nous sommes une agence de voyages.", "fr").ok);
  record("partner wording fails", !validateTranslation("Our guide meets you.", "Unser Partner vor Ort trifft Sie.", "de").ok);
  record("local operator wording fails", !validateTranslation("Our guide meets you.", "A local operator meets you.", "es").ok);
  record("supplier wording fails", !validateTranslation("Hotels we arrange.", "Hôtels de nos fournisseurs.", "fr").ok);
  record("quartiers is not 'tiers'", validateTranslation("Old town districts.", "Les quartiers de la vieille ville.", "fr").ok);
  record("headings are not translated per entry", !collectFields({ itinerary: [], headings: { h1: { en: "H" } }, title: { en: "T" } }, null).some((f) => f.path.startsWith("headings")));
  record("dropped number fails", !validateTranslation("from $10 on day 2", "from $10", "de").ok);
  record(
    "changed url fails",
    !validateTranslation("see https://res.cloudinary.com/demo/a.jpg", "see https://res.cloudinary.com/other/a.jpg", "de").ok,
  );
  record(
    "cloudinary url passes",
    validateTranslation("see https://res.cloudinary.com/demo/a.jpg", "siehe https://res.cloudinary.com/demo/a.jpg", "de").ok,
  );
  record(
    "locale path may change",
    validateTranslation("go /en/packages/foo/", "gehe /de/packages/foo/", "de").ok,
  );
  record(
    "wrong locale path fails",
    !validateTranslation("go /en/packages/foo/", "gehe /fr/packages/foo/", "de").ok,
  );
  record("missing currency fails", !validateTranslation("€10 USD", "€10", "de").ok);
  record("currency passes", validateTranslation("€10 USD", "€10 USD", "de").ok);
  record(
    "placeholder passes",
    validateTranslation("Hi {name} {{x}} %s <br>", "Hallo {name} {{x}} %s <br>", "de").ok,
  );
  record(
    "placeholder dropped fails",
    !validateTranslation("Hi {name}", "Hallo", "de").ok,
  );
  const md = "# Title\n\n- item\n\nSee [a](https://example.com/a) and **b**";
  record("markdown passes", validateTranslation(md, md, "de").ok);
  record("lost heading fails", !validateTranslation(md, md.replace("# Title", "Title"), "de").ok);
  record("partner rejected", !validateTranslation("Our team", "our partner", "de").ok);
  const brand = validateTranslation("our partner", "unser partner", "de");
  record(
    "english brand still rejected",
    !brand.ok && brand.reasons.some((reason) => reason.includes("fix the English source")),
    brand.reasons.join(", "),
  );
  record(
    "list element-wise",
    validateTranslation(["from $10", "see /en/a/"], ["ab $10", "siehe /de/a/"], "de").ok,
  );
  record("list length fails", !validateTranslation(["from $10", "two"], ["ab $10"], "de").ok);
  record("ja requires CJK", !validateTranslation("Hello", "「ja」 Hello", "ja").ok);
  record("ja with CJK passes", validateTranslation("Hello", "こんにちは Hello", "ja").ok);

  const goodKeywords = { focus_keyword: "de focus", keywords: ["de kw 1", "de kw 2", "de kw 3", "de kw 4", "de kw 5"] };
  record("keywords pass", validateTranslation({ focus_keyword: "sample" }, goodKeywords, "de").ok);
  record(
    "keywords too short",
    !validateTranslation({}, { focus_keyword: "de focus", keywords: ["a", "b", "c", "d"] }, "de").ok,
  );
  record(
    "keywords duplicate",
    !validateTranslation(
      {},
      { focus_keyword: "de focus", keywords: ["Same", "same", "b", "c", "d", "e"] },
      "de",
    ).ok,
  );
  record(
    "keywords partner",
    !validateTranslation({}, { focus_keyword: "partner", keywords: ["a", "b", "c", "d", "e"] }, "de").ok,
  );
  record(
    "ja keywords need CJK",
    !validateTranslation({}, goodKeywords, "ja").ok,
  );

  const tiny = Array.from({ length: 31 }, (_, index) => ({ id: String(index), chars: 1 }));
  record("batch splits at 30", packBatches(tiny).length === 2 && packBatches(tiny)[0].length === 30);
  const long = [{ id: "long", chars: 9001 }, { id: "next", chars: 10 }];
  record("long field is alone", packBatches(long).length === 2 && packBatches(long)[0].length === 1);
  const wide = [{ id: "a", chars: 5000 }, { id: "b", chars: 5000 }];
  record("char budget splits", packBatches(wide).length === 2);

  record(
    "default translate model is llama-3.3-70b-instruct-fp8-fast",
    TRANSLATE_MODEL === "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  );
  const llamaRates = NEURON_RATES["@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
  record(
    "llama 3.3 70b neuron rate",
    estimateNeurons("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 1_000_000, 0) === llamaRates.inputPerMillion,
  );
  const rates = NEURON_RATES["@cf/mistralai/mistral-small-3.1-24b-instruct"];
  record(
    "mistral neuron rate",
    estimateNeurons("@cf/mistralai/mistral-small-3.1-24b-instruct", 1_000_000, 0) === rates.inputPerMillion,
  );
  record(
    "m2m neuron rate",
    estimateNeurons("@cf/meta/m2m100-1.2b", 500_000, 500_000) === 31050,
  );
}

async function pipelineChecks() {
  const cwd = tempProject();
  try {
    const humanRel = "content/packages/human-only.json";
    const humanDoc = {
      slug: "human-only",
      title: { en: "Kept", de: "Bleibt", fr: "Reste", ja: "そのまま", es: "Queda" },
    };
    writeDoc(cwd, humanRel, humanDoc);
    const humanBytes = readFileSync(join(cwd, humanRel));

    writeDoc(cwd, "content/packages/sample.json", sampleDoc());
    const sampleBytes = readFileSync(join(cwd, "content", "packages", "sample.json"));
    copyFileSync(realPackage, join(cwd, "content", "packages", "3-stans-discovery-14-days.json"));
    const realBytes = readFileSync(join(cwd, "content", "packages", "3-stans-discovery-14-days.json"));

    const dry = await runAutoTranslate(["--dry-run"], {
      cwd,
      env: {},
      fetch: async () => {
        throw new Error("dry-run must not fetch");
      },
    });
    record(
      "dry-run makes no writes",
      dry.code === 0 &&
        sampleBytes.equals(readFileSync(join(cwd, "content", "packages", "sample.json"))) &&
        !existsSync(join(cwd, "content", ".translations")),
    );
    record(
      "dry-run counts missing",
      dry.counts["content/packages/sample.json"].de.missing > 0 && dry.counts["content/packages/sample.json"].de.human > 0,
      JSON.stringify(dry.counts["content/packages/sample.json"].de),
    );
    record("dry-run plans calls", dry.calls > 0 && dry.filesChanged === 0 && dry.failures.length === 0);
    record("real package untouched by dry-run", realBytes.equals(readFileSync(join(cwd, "content", "packages", "3-stans-discovery-14-days.json"))));

    const outputFile = join(cwd, "github-output.txt");
    writeFileSync(outputFile, "");
    const first = await runAutoTranslate(["--mock"], {
      cwd,
      env: { GITHUB_OUTPUT: outputFile },
      fetch: async () => {
        throw new Error("mock must not fetch");
      },
    });
    const doc = readDoc(cwd, "content/packages/sample.json");
    const side = readDoc(cwd, "content/.translations/packages/sample.json");
    record("missing title translated", doc.title.de === "「de」 Almaty from $10", doc.title.de);
    record(
      "sidecar hashes title",
      side.version === 1 &&
        side.fields.title.src === hashCanonical("Almaty from $10") &&
        side.fields.title.de === hashCanonical(doc.title.de),
    );
    record("summary keeps markdown and facts", doc.summary.de === `「de」 ${COPY}`, doc.summary.de);
    record("included list translated", doc.included.de[0] === "「de」 Hotel for 2" && doc.included.de[1] === "「de」 Guide");
    record("pre-existing summary stays", doc.summary.fr === "Déjà traduit");
    record("pre-existing style stays", doc.style.de === "Berge");
    record(
      "human paths logged",
      first.human.some((item) => item.path === "summary" && item.locale === "fr") &&
        first.human.some((item) => item.path === "style" && item.locale === "de"),
    );
    record("ja title left empty", doc.title.ja === "");
    record(
      "ja failure logged",
      first.failures.some((item) => item.locale === "ja" && item.path === "title" && item.reasons.some((reason) => /CJK/i.test(reason))),
    );
    record("seo title translated", doc.seo.de.seo_title === "「de」 Sample tour from $10");
    record(
      "seo keywords generated",
      Array.isArray(doc.seo.de.keywords) && doc.seo.de.keywords[0] === "de kw 1" && !doc.seo.de.keywords.includes("sample tour"),
    );
    record("seo focus generated", doc.seo.de.focus_keyword === "de focus");
    record(
      "seo og canonical untouched, de published once complete",
      doc.seo.de.og_image === "https://res.cloudinary.com/demo/og.jpg" &&
        doc.seo.de.canonical === "/en/packages/sample/" &&
        doc.seo.de.noindex === false,
    );
    record("ja keeps noindex after a failed field", !doc.seo.ja || doc.seo.ja.noindex !== false, JSON.stringify(doc.seo.ja));
    record("numbers and slug untouched", doc.durationDays === 14 && doc.slug === "sample");
    const written = readFileSync(join(cwd, "content", "packages", "sample.json"), "utf8");
    record(
      "written json format",
      written.endsWith("\n") && written === `${JSON.stringify(doc, null, 2)}\n` && !written.includes("\\u"),
    );
    record("human file bytes unchanged", humanBytes.equals(readFileSync(join(cwd, humanRel))));
    record("real package bytes unchanged", realBytes.equals(readFileSync(join(cwd, "content", "packages", "3-stans-discovery-14-days.json"))));
    const github = readFileSync(outputFile, "utf8");
    record("github output changed", github.includes("changed=true") && github.includes("pending=false"), github);

    const second = await runAutoTranslate(["--mock", "--file", "content/packages/sample.json"], { cwd, env: {} });
    const again = readDoc(cwd, "content/packages/sample.json");
    record("current title stays", again.title.de === doc.title.de && second.filesChanged === 0);
    record(
      "second run counts current",
      second.counts["content/packages/sample.json"].de.current > 0,
      JSON.stringify(second.counts["content/packages/sample.json"].de),
    );

    again.title.en = "Almaty from $12";
    writeDoc(cwd, "content/packages/sample.json", again);
    const stale = await runAutoTranslate(["--mock", "--file", "content/packages/sample.json"], { cwd, env: {} });
    const staleDoc = readDoc(cwd, "content/packages/sample.json");
    const staleSide = readDoc(cwd, "content/.translations/packages/sample.json");
    record("stale title retranslated", staleDoc.title.de === "「de」 Almaty from $12", staleDoc.title.de);
    record("stale sidecar src updated", staleSide.fields.title.src === hashCanonical("Almaty from $12"));
    record("stale run translated", stale.translated.de > 0);

    staleDoc.title.de = "Mensch $12";
    writeDoc(cwd, "content/packages/sample.json", staleDoc);
    const human = await runAutoTranslate(["--mock", "--file", "content/packages/sample.json"], { cwd, env: {} });
    const humanEdited = readDoc(cwd, "content/packages/sample.json");
    record("human edit kept", humanEdited.title.de === "Mensch $12");
    record(
      "human edit logged",
      human.human.some((item) => item.path === "title" && item.locale === "de"),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function capAndFailureChecks() {
  const cwd = tempProject();
  try {
    writeDoc(cwd, "content/packages/cap.json", {
      slug: "cap",
      title: { en: "Hello", de: "", fr: "" },
      summary: { en: "World", de: "", fr: "" },
    });
    const capped = await runAutoTranslate(["--mock", "--max-calls", "1"], { cwd, env: {} });
    const doc = readDoc(cwd, "content/packages/cap.json");
    record("cap translates first locale", doc.title.de === "「de」 Hello" && doc.summary.de === "「de」 World", doc.title.de);
    record("cap stops later locales", doc.title.fr === "" && capped.calls === 1, `calls ${capped.calls}`);
    record(
      "cap logs remainder",
      capped.deferred.some((item) => item.locale === "fr" && item.path === "title"),
    );

    writeDoc(cwd, "content/packages/partner.json", {
      slug: "partner",
      title: {
        en: "We are a partner agency for this $10 tour",
        de: "",
        fr: "Humain",
        ja: "人間の文章です",
        es: "Humano",
      },
    });
    const partner = await runAutoTranslate(["--mock", "--file", "content/packages/partner.json"], {
      cwd,
      env: {},
      translate: undefined,
    });
    const partnerDoc = readDoc(cwd, "content/packages/partner.json");
    record("partner field left empty", partnerDoc.title.de === "");
    record(
      "partner failure logged",
      partner.failures.some(
        (item) =>
          item.path === "title" &&
          item.locale === "de" &&
          item.reasons.some((reason) => reason === "brand wording") &&
          item.reasons.some((reason) => reason.includes("fix the English source")),
      ),
      partner.failures.map((item) => item.reasons.join("|")).join(" || "),
    );
    record("partner retried once", partner.calls === 2, `calls ${partner.calls}`);
    record("partner wrote no sidecar", !existsSync(join(cwd, "content", ".translations", "packages", "partner.json")));

    let seen = [];
    const recovered = await runAutoTranslate(["--file", "content/packages/partner.json"], {
      cwd,
      env: { TRANSLATE_SECRET: "not-printed" },
      translate: async ({ target, items }) => {
        seen.push(items.map((item) => item.id));
        const results = {};
        const attempt = seen.length;
        for (const item of items) {
          results[item.id] = attempt === 1 ? "dropped" : `「${target}」 A $10 trip`;
        }
        return {
          model: TRANSLATE_MODEL,
          results,
          missing: [],
          usage: { prompt_tokens: 8, completion_tokens: 8 },
        };
      },
    });
    const recoveredDoc = readDoc(cwd, "content/packages/partner.json");
    record(
      "retry then accept",
      recoveredDoc.title.de.startsWith("「de」 ") && recoveredDoc.title.de.includes("$10"),
      recoveredDoc.title.de,
    );
    record("retry calls", seen.length === 2 && recovered.code === 0, JSON.stringify(seen));

    writeDoc(cwd, "content/packages/split.json", {
      slug: "split",
      title: { en: "Pay $10", de: "", fr: "Humain", ja: "人間です", es: "Humano" },
      summary: { en: "Walk", de: "", fr: "Humain", ja: "歩く", es: "Humano" },
    });
    const batches = [];
    await runAutoTranslate(["--file", "content/packages/split.json"], {
      cwd,
      env: { TRANSLATE_SECRET: "not-printed" },
      translate: async ({ items }) => {
        batches.push(items.map((item) => item.id));
        const results = {};
        for (const item of items) {
          results[item.id] = item.id === "title" && batches.length === 1 ? "no number" : `「de」 ${item.text}`;
        }
        return {
          model: TRANSLATE_MODEL,
          results,
          missing: [],
          usage: { prompt_tokens: 4, completion_tokens: 4 },
        };
      },
    });
    record(
      "retry only the failed item",
      batches.length === 2 && batches[0].includes("title") && batches[0].includes("summary") && batches[1].join() === "title",
      JSON.stringify(batches),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function endpointChecks() {
  const cwd = tempProject();
  try {
    writeDoc(cwd, "content/packages/net.json", {
      slug: "net",
      title: { en: "Hello $5", de: "", fr: "Humain", ja: "人間です", es: "Humano" },
    });
    let fetches = 0;
    let sleeps = 0;
    const pending = await runAutoTranslate(["--file", "content/packages/net.json"], {
      cwd,
      env: { TRANSLATE_SECRET: "local-test-secret", TRANSLATE_URL: "http://127.0.0.1:9/api/translate" },
      sleep: async () => {
        sleeps += 1;
      },
      fetch: async () => {
        fetches += 1;
        return new Response("missing", { status: 404 });
      },
    });
    record("404 is pending without retries", pending.code === 0 && pending.pending && fetches === 1, `fetches ${fetches}`);
    record("404 does not sleep", sleeps === 0);

    fetches = 0;
    const output = join(cwd, "out.txt");
    writeFileSync(output, "");
    const denied = await runAutoTranslate(["--file", "content/packages/net.json"], {
      cwd,
      env: {
        TRANSLATE_SECRET: "local-test-secret",
        TRANSLATE_URL: "http://127.0.0.1:9/api/translate",
        GITHUB_OUTPUT: output,
      },
      fetch: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
      stdout: () => {},
      stderr: (line) => {
        record("401 message hides secret", !line.includes("local-test-secret"), line);
      },
    });
    record("401 exits 1", denied.code === 1 && denied.pending === false);
    record("401 output pending false", readFileSync(output, "utf8").includes("pending=false"));

    fetches = 0;
    sleeps = 0;
    const down = await runAutoTranslate(["--file", "content/packages/net.json"], {
      cwd,
      env: { TRANSLATE_SECRET: "local-test-secret", TRANSLATE_URL: "http://127.0.0.1:9/api/translate" },
      sleep: async () => {
        sleeps += 1;
      },
      fetch: async () => {
        fetches += 1;
        throw new Error("down");
      },
    });
    record("network gives up pending", down.code === 0 && down.pending && fetches === 4 && sleeps === 3, `fetches ${fetches} sleeps ${sleeps}`);
    const untouched = readDoc(cwd, "content/packages/net.json");
    record("failed runs leave the field empty", untouched.title.de === "");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function functionChecks() {
  if (!process.env.BASE) {
    console.log("SKIP pages function (BASE unset)");
    return;
  }
  const base = process.env.BASE.replace(/\/$/, "");
  const unauth = await fetch(`${base}/api/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "de", mode: "translate", items: [{ id: "a", text: "Hello" }] }),
  });
  record("function without secret is 401", unauth.status === 401);
  record("function sets no CORS header", !unauth.headers.has("access-control-allow-origin"));

  const secret = process.env.TEST_TRANSLATE_SECRET;
  if (!secret) {
    record("TEST_TRANSLATE_SECRET is set", false, "BASE is set");
    return;
  }
  const authed = await fetch(`${base}/api/translate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-translate-secret": secret,
    },
    body: JSON.stringify({
      target: "de",
      mode: "translate",
      items: [
        { id: "a", text: "Hello 5" },
        { id: "b", text: "World" },
      ],
    }),
  });
  let body = null;
  try {
    body = await authed.json();
  } catch {
    body = null;
  }
  const idsOk = body && body.results && typeof body.results.a === "string" && typeof body.results.b === "string";
  record("function mock returns every id", authed.status === 200 && idsOk, `status ${authed.status}`);

  const method = await fetch(`${base}/api/translate`, { method: "GET" });
  record("function GET is 405", method.status === 405);
}

/** The 3 Almaty trips were machine-translated, then hand-edited (トウヒ, Charyn-Canyon, 1名あたり…から, no gender star). */
async function almatyHandEditChecks() {
  const cwd = mkdtempSync(join(tmpdir(), "mt-almaty-"));
  try {
    const files = ["charyn-kolsai-kaindy-2-days", "turgen-gorge-assy-plateau-2-days", "bogdanovich-glacier-day-hike"];
    for (const name of files) {
      for (const rel of [`content/packages/${name}.json`, `content/.translations/packages/${name}.json`]) {
        mkdirSync(dirname(join(cwd, rel)), { recursive: true });
        copyFileSync(join(root, rel), join(cwd, rel));
      }
    }
    const before = files.map((name) => readFileSync(join(cwd, `content/packages/${name}.json`)));
    const dry = await runAutoTranslate(["--dry-run"], {
      cwd,
      env: {},
      stdout: () => {},
      stderr: () => {},
      fetch: async () => {
        throw new Error("dry-run must not fetch");
      },
    });
    const human = (dry.human || []).map((item) => `${item.file} ${item.locale} ${item.path}`);
    const expectHuman = [
      "content/packages/charyn-kolsai-kaindy-2-days.json ja seo.meta_description",
      "content/packages/charyn-kolsai-kaindy-2-days.json ja summary",
      "content/packages/charyn-kolsai-kaindy-2-days.json de title",
      "content/packages/charyn-kolsai-kaindy-2-days.json de faqs[0].a",
      "content/packages/turgen-gorge-assy-plateau-2-days.json ja itinerary[0].description",
      "content/packages/bogdanovich-glacier-day-hike.json de title",
    ];
    for (const key of expectHuman) record(`hand-edited Almaty field is human-owned: ${key.replace("content/packages/", "")}`, human.includes(key));
    record("hand-edited Almaty files plan no calls", dry.code === 0 && dry.calls === 0, `calls ${dry.calls}`);
    record(
      "hand-edited Almaty files untouched by dry-run",
      files.every((name, i) => before[i].equals(readFileSync(join(cwd, `content/packages/${name}.json`)))),
    );
    for (const name of files) {
      const doc = JSON.parse(readFileSync(join(cwd, `content/packages/${name}.json`), "utf8"));
      for (const locale of ["de", "ja"]) {
        record(`${name} ${locale} stays published`, doc.seo?.[locale]?.noindex === false);
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function main() {
  unitChecks();
  await pipelineChecks();
  await almatyHandEditChecks();
  await capAndFailureChecks();
  await endpointChecks();
  await functionChecks();
  if (failed > 0) {
    console.error(`${failed} failed`);
    process.exit(1);
  }
  console.log("All auto-translate checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
