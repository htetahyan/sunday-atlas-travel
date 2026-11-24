#!/usr/bin/env node
/** Unit checks for the blog translation number/brand gates and per-field fallback. No network. */
import assert from "node:assert/strict";
import {
  blogNumbersOk,
  englishNumbersKept,
  fieldFallback,
  normaliseJapaneseNumerals,
  translateGlossary,
  noTranslatableWords,
  splitSentences,
  unwrapSingleValue,
  validateBlogTranslation,
  brandNeutral,
  paragraphLists,
  PARAGRAPH_FIELD,
} from "./blog-daily.mjs";
import { BANNED_RE, wordingProblems } from "./lib/blog-core.mjs";
import { withoutRuleSentences } from "./blog-daily.mjs";
import { translateStrings } from "./blog-daily.mjs";
import { createLimiter, mapLimit, translateModelsFor } from "./lib/blog-ai-client.mjs";

let n = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  n += 1;
};

// Real failing pairs from local NVIDIA runs (2026-10-29).
const chorsuEn =
  "Chorsu Bazaar sits under a soaring blue-tiled dome about three kilometers southeast of Amir Timur Square, a ten-minute drive or twenty minutes by metro to Chorsu station. The current structure dates to the 1980s but the market itself has operated on this spot for centuries, feeding caravans and city residents alike. Inside, vaulted aisles radiate from the central hall where mountains of spices — cumin, paprika, barberries — sit beside pyramids of dried apricots, raisins and walnuts. Early morning, between eight and ten, is the quietest time to photograph the non ovens pulling fresh golden loaves from clay walls. Vendors expect polite bargaining; start at roughly two-thirds of the asking price and smile through the back-and-forth. A reusable cloth bag helps you avoid the thin plastic sheets still common at checkout.";
const chorsuJa =
  "チョルスー・バザールは、青いタイルの高いドームの下にあり、アミール・ティムール広場から南東へ約3キロメートル、車で10分、地下鉄ならチョルスー駅まで20分です。現在の建物は1980年代のものですが、市場自体は何世紀にもわたってこの場所で営まれ、キャラバンや市民の台所を支えてきました。内部では、中央ホールからアーチ型の通路が放射状に伸び、クミン、パプリカ、ザクロの実などのスパイスの山が、ドライアプリコット、レーズン、クルミのピラミッドと並んでいます。朝8時から10時の間が最も静かで、ナン窯から粘土の壁に張り付いた黄金色のパンが取り出される様子を撮影するのに最適です。値切りは礼儀正しく行うのが慣習で、提示価格の約3分の2から始め、笑顔でやり取りを楽しみましょう。レジでは薄いビニール袋がまだ一般的なので、繰り返し使える布袋を持参すると便利です。";
ok(
  validateBlogTranslation(chorsuEn, chorsuJa, "ja").ok,
  "ja chorsu two-thirds / eight to ten",
);
ok(
  validateBlogTranslation(
    "start at roughly two-thirds of the asking price",
    "commencez à environ les deux tiers du prix demandé",
    "fr",
  ).ok,
  "fr deux tiers is a fraction",
);
ok(
  !validateBlogTranslation(
    "we work with locals",
    "nous travaillons avec des tiers",
    "fr",
  ).ok,
  "fr des tiers is still brand wording",
);
ok(
  validateBlogTranslation(
    "9 am to 6 pm daily, shorter on holidays",
    "Täglich von 9 bis 18 Uhr, an Feiertagen kürzer",
    "de",
  ).ok,
  "de 24h clock",
);
ok(
  validateBlogTranslation(
    "9 am to 6 pm daily, shorter on holidays",
    "9 h à 18 h tous les jours, horaires réduits les jours fériés",
    "fr",
  ).ok,
  "fr 24h clock",
);
ok(
  validateBlogTranslation(
    "7th-century Quran manuscript in climate-controlled case",
    "manuscrito coránico del siglo VII en estuche con control climático",
    "es",
  ).ok,
  "es roman century",
);
ok(
  validateBlogTranslation(
    "7th-century Quran manuscript in climate-controlled case",
    "7. Jahrhundert altes Quran-Manuskript in einem klimatisierten Vitrinenschrank",
    "de",
  ).ok,
  "de 7. not a list",
);
ok(
  validateBlogTranslation(
    "5:00 AM to midnight daily",
    "毎日午前5時から深夜12時まで",
    "ja",
  ).ok,
  "ja midnight",
);

// Japanese numerals.
assert.equal(normaliseJapaneseNumerals("二十五分"), "25分");
assert.equal(normaliseJapaneseNumerals("三千メートル"), "3000メートル");
assert.equal(normaliseJapaneseNumerals("1万人"), "10000人");
assert.equal(normaliseJapaneseNumerals("１．５万"), "15000");
assert.equal(normaliseJapaneseNumerals("2時間半"), "2.5時間");
assert.equal(normaliseJapaneseNumerals("一部の店"), "一部の店");
assert.equal(normaliseJapaneseNumerals("一日"), "1日");
n += 7;
ok(
  blogNumbersOk(
    "The drive takes about two and a half hours over 300 kilometers.",
    "車で約2時間半、300キロメートルの道のりです。",
    "ja",
  ),
  "ja 時間半 from words",
);
ok(
  blogNumbersOk(
    "The trip is 2.5 hours and covers 300 km.",
    "所要時間は2時間半、距離は300キロです。",
    "ja",
  ),
  "ja 2.5 hours",
);
ok(
  blogNumbersOk(
    "Around 10,000 visitors come each day.",
    "毎日約1万人が訪れます。",
    "ja",
  ),
  "ja 1万",
);
ok(
  blogNumbersOk(
    "Built in the 16th century, it has twenty-five domes.",
    "16世紀に建てられ、二十五のドームがあります。",
    "ja",
  ),
  "ja kanji 25",
);
ok(
  blogNumbersOk(
    "Most visitors spend 3 days here.",
    "ほとんどの旅行者はここで三日間過ごします。",
    "ja",
  ),
  "ja kanji day count",
);
ok(
  blogNumbersOk(
    "Plan a 2-night stay in the 1800s merchant quarter.",
    "19世紀の商人街で2泊の滞在を計画しましょう。",
    "ja",
  ),
  "ja 1800s as century",
);
ok(
  blogNumbersOk("Allow 10 minutes", "Comptez dix minutes", "fr"),
  "fr spelled 10",
);
ok(
  blogNumbersOk("Allow 15 minutes", "Calcule quince minutos", "es"),
  "es spelled 15",
);
ok(
  !blogNumbersOk("Tickets cost 120 USD", "入場料は150米ドルです。", "ja"),
  "ja changed number still fails",
);
ok(
  !blogNumbersOk("Open from 9 am", "Geöffnet ab 9 Uhr, 1450 Stufen", "de"),
  "new large number fails",
);
ok(
  englishNumbersKept(
    "Spend 2 days here.",
    "Verbringen Sie hier 2 Tage, 3 Nächte.",
    "de",
  ),
  "extras small kept",
);
ok(
  !englishNumbersKept(
    "Spend 2 days here.",
    "Verbringen Sie hier 4 Tage.",
    "de",
  ),
  "missing number not kept",
);

// Per-field fallback.
const para = { id: "s0.p1", text: "Spend 2 days here." };
ok(
  fieldFallback(
    para,
    [
      {
        value: "Verbringen Sie hier 2 Tage, 3 Nächte.",
        reasons: ["numbers differ"],
      },
    ],
    "de",
  )?.kind === "kept translation with extra numbers",
  "paragraph keeps translation",
);
ok(
  fieldFallback(
    para,
    [{ value: "Verbringen Sie hier 4 Tage.", reasons: ["numbers differ"] }],
    "de",
  ) === null,
  "paragraph with wrong number is not saved",
);
ok(
  fieldFallback(
    para,
    [
      {
        value: "Maßgeschneiderte 2 Tage.",
        reasons: ["numbers differ", "banned word"],
      },
    ],
    "de",
  ) === null,
  "banned never accepted",
);
ok(
  fieldFallback({ id: "s3.heading", text: "Getting there" }, [], "ja")
    ?.value === "Getting there",
  "heading → English",
);
ok(
  fieldFallback({ id: "s2.h0", text: "Climb the 3 domes" }, [], "ja")?.value ===
    "Climb the 3 domes",
  "highlight → English",
);
ok(
  fieldFallback({ id: "a1", text: "Yes." }, [], "ja") === null,
  "FAQ answer has no English fallback",
);

// Glossary.
ok(
  /a medida/.test(translateGlossary("es")) &&
    /sur-mesure/.test(translateGlossary("fr")) &&
    /Sunday Atlas Travel/.test(translateGlossary("ja")),
  "glossary",
);

// Failures from the first daily run (2026-10-30).
ok(
  validateBlogTranslation(
    "Shoulder seasons deliver mild temperatures and full market stalls",
    "Les saisons intermédiaires offrent des températures douces et des étals de marché bien garnis",
    "fr",
  ).ok,
  "fr saisons intermédiaires is not a middleman",
);
ok(
  validateBlogTranslation(
    "A fleece mid-layer keeps you warm.",
    "Une couche intermédiaire en polaire vous garde au chaud.",
    "fr",
  ).ok,
  "fr couche intermédiaire is not a middleman",
);
ok(
  !validateBlogTranslation(
    "We book directly.",
    "Nous passons par un intermédiaire.",
    "fr",
  ).ok,
  "fr un intermédiaire still blocked",
);
ok(validateBlogTranslation("4 km", "4 km", "ja").ok, "ja unit-only value may stay");
ok(validateBlogTranslation("18-22°C", "18-22°C", "ja").ok, "ja temperature value may stay");
ok(noTranslatableWords("2h 10min") && !noTranslatableWords("Siab Bazaar"), "no-word detector");
ok(
  !validateBlogTranslation("Siab Bazaar sits beside the mosque.", "Siab Bazaar sits beside the mosque.", "ja").ok,
  "ja untranslated prose still blocked",
);
const twoEn = "Our private vehicle picks you up. The guide explains the geology.";
const twoJson = JSON.stringify({
  "Our private vehicle picks you up.": "Notre véhicule privé vient vous chercher.",
  "The guide explains the geology.": "Le guide explique la géologie.",
});
ok(
  unwrapSingleValue(twoJson, twoEn, "fr") ===
    "Notre véhicule privé vient vous chercher. Le guide explique la géologie.",
  "sentence-keyed JSON reply is joined",
);
ok(
  unwrapSingleValue('{"a": "x", "b": "y"}', "Something else.", "fr") === '{"a": "x", "b": "y"}',
  "unrelated JSON left alone",
);
ok(
  splitSentences("Trains leave at 7 a.m. daily. Tickets cost 2.5 times more in summer! Book early.").length === 3,
  "sentence splitter",
);

// Run 40997721080 (2026-10-30): exact strings from the log.
const chorsuSeasonEn =
  "Spring and autumn mornings are ideal, when temperatures sit in the low twenties and the produce is at its seasonal peak. Summer heat pushes the market's rhythm earlier, with bread ovens firing at dawn and plov served by 10 am before the day peaks above 35°C. Winter visits are quieter; you will still find bread and root vegetables, but the dried-fruit selection shrinks. The bazaar sits at the edge of the old town, so you can combine it with a walk to the nearby Kukeldash Madrasah and the Juma Mosque, both within two hundred metres.";
const chorsuSeasonJa =
  "春と秋の朝は理想的で、気温は20度前半、農産物は季節の盛りを迎えます。夏の暑さで市場のリズムは早まり、パンのオーブンは夜明けに火が入り、プロフは10時までに提供され、日中は35℃を超えます。冬の訪問は静かです。パンと根菜はまだ見つかりますが、ドライフルーツの品揃えは減ります。バザールは旧市街の端にあり、近くのククエルダシュ・マドラサとジュマ・モスクへの散歩と組み合わせることができます。どちらも200メートル以内です。";
ok(validateBlogTranslation(chorsuSeasonEn, chorsuSeasonJa, "ja").ok, "ja low twenties / two hundred metres");
const heatEn =
  "Summer heat pushes surface temperatures above forty degrees Celsius in July, making midday walks across the open Registan courtyard exhausting without a shaded vehicle nearby.";
const heatJa = "7月の夏の暑さで地表温度は40度を超え、日陰の車が近くにないとレギスタン広場の開けた中庭を正午に歩くのは疲れる。";
ok(validateBlogTranslation(heatEn, heatJa, "ja").ok, "ja forty degrees / July");
const trainEn =
  "The Afrosiyob high-speed train links Tashkent, Samarkand and Bukhara on a schedule that rarely changes in winter, completing the 300-kilometre leg to Samarkand in two hours ten minutes and the 260-kilometre leg to Bukhara in three hours forty minutes. Seats are heated and the carriages stay warm, so the journey feels more comfortable than a shared taxi on icy highways. If you plan to cross the Kyzyl-Kum Desert by road, the 450-kilometre stretch along the Amudarya can take seven to eight hours in clear conditions but may extend to ten hours when fog or drifting snow reduces visibility.";
const trainJa =
  "アフロシヤブ高速列車はタシュケント、サマルカンド、ブハラを結び、冬でもほとんど変わらないダイヤで運行されています。サマルカンドまでの300キロメートルの区間を2時間10分、ブハラまでの260キロメートルの区間を3時間40分で結びます。座席は暖房付きで車内は暖かく、凍った高速道路を走る相乗りタクシーよりも快適に移動できます。キジルクム砂漠を陸路で横断する場合、アムダリヤ川沿いの450キロメートルの区間は天候が良ければ7〜8時間かかりますが、霧や地吹雪で視界が悪いと10時間に延びることもあります。";
ok(validateBlogTranslation(trainEn, trainJa, "ja").ok, "ja two hours ten minutes / seven to eight");
ok(validateBlogTranslation(trainEn, trainJa.replace("七", "七").replace("二〇", "20"), "ja").ok, "ja kanji form");
ok(
  validateBlogTranslation(trainEn, trainJa.replace("2時間10分", "二時間十分").replace("7〜8", "七〜八"), "ja").ok,
  "ja kanji numerals accepted",
);
ok(
  !validateBlogTranslation(trainEn, trainJa.replace("300キロメートル", "350キロメートル"), "ja").ok,
  "ja changed digit number still rejected",
);
ok(
  !validateBlogTranslation(trainEn, trainJa.replace("450キロメートル", "450キロメートル（約900ドル）"), "ja").ok,
  "ja invented large number still rejected",
);
const autumnEn =
  "Our Tashkent & Chimgan Mountains 5-Day Private Tour runs year-round and fits autumn perfectly: two city days cover Chorsu Bazaar at harvest peak and the Khast Imam Complex, while day three heads to Amirsoy and the Chimgan slopes for golden-larch scenery and lake views.";
const autumnJa =
  "タシュケント＆チムガン山脈5日間プライベートツアーは年間を通じて催行され、秋にぴったりです。2日間の市内観光では、収穫期のチョルスーバザールとハスト・イマーム複合施設を巡り、3日目はアミルソイとチムガンの斜面へ向かい、黄金色のカラマツの景色と湖の眺望を楽しめます。";
ok(validateBlogTranslation(autumnEn, autumnJa, "ja").ok, "ja two city days / day three");
const chimEn =
  "The day starts with a two-hour drive from Tashkent into the Western Tian Shan, gaining roughly 1,500 meters of elevation before the first gondola ride. Morning temperatures at the valley floor can be ten degrees warmer than the upper stations, so a lightweight insulated jacket that packs into its own pocket is essential. A long-sleeve sun shirt, a fleece mid-layer and a windproof shell give you three combinations for the shifting conditions between Amirsoy, Chimgan and the Charvak shoreline.";
const chimFr =
  "La journée commence par un trajet de deux heures depuis Tachkent jusqu'au Tian Shan occidental, avec environ 1 500 mètres de dénivelé avant la première montée en télécabine. Les températures matinales au fond de la vallée peuvent être dix degrés plus élevées qu'aux stations supérieures, donc une veste légère et isolante qui se range dans sa propre poche est indispensable. Un t-shirt à manches longues anti-UV, une polaire intermédiaire et une veste coupe-vent vous offrent trois combinaisons pour les conditions changeantes entre Amirsoy, Chimgan et le rivage de Charvak.";
ok(validateBlogTranslation(chimEn, chimFr, "fr").ok, "fr polaire intermédiaire (fr:s4.p0)");
ok(
  validateBlogTranslation(
    "We recommend the shoulder seasons for the fullest experience.",
    "Nous recommandons les Saisons\u00a0Intermédiaires pour l\u2019expérience la plus complète.",
    "fr",
  ).ok,
  "fr case / nbsp tolerant",
);
ok(/intermédiaire/.test(brandNeutral("par l'intermédiaire de")), "fr par l'intermédiaire still checked");
ok(!validateBlogTranslation("We book directly.", "Nous réservons via des intermédiaires.", "fr").ok, "fr des intermédiaires blocked");
ok(
  validateBlogTranslation("Allow a third of the day for the bazaar.", "Prévoyez un tiers de la journée pour le bazar.", "fr").ok,
  "fr un tiers de = fraction",
);
const fr42 = JSON.stringify({
  "Our private vehicle picks you up at your Tashkent hotel and returns you there, so there is no need to arrange taxis or shared minibuses.":
    "Notre véhicule privé vous prend en charge à votre hôtel à Tachkent et vous y ramène, vous n'avez donc pas besoin d'organiser de taxis ou de minibus partagés.",
  "Bottled water is provided throughout the day.": "De l'eau en bouteille est fournie tout au long de la journée.",
}, null, 2);
const fr42En =
  "Our private vehicle picks you up at your Tashkent hotel and returns you there, so there is no need to arrange taxis or shared minibuses. Bottled water is provided throughout the day.";
const fr42Out = unwrapSingleValue(fr42, fr42En, "fr");
ok(fr42Out.startsWith("Notre véhicule") && validateBlogTranslation(fr42En, fr42Out, "fr").ok, "fr sentence-map (fr:s4.p2) unwrapped and valid");
ok(!BANNED_RE.test("a medida que avanza el día") && BANNED_RE.test("un viaje a medida") && BANNED_RE.test("hecho a medida"), "es a medida que is not 'tailor-made'");
// Paragraph drop: one failed paragraph in one locale keeps the post; all paragraphs failing does not.
ok(PARAGRAPH_FIELD.test("s3.p0") && PARAGRAPH_FIELD.test("p1") && !PARAGRAPH_FIELD.test("s3.f0.v") && !PARAGRAPH_FIELD.test("a3"), "paragraph ids");
{
  const tr = { en: { "s1.p0": "A", "s1.p1": "B" }, de: { "s1.p0": "A", "s1.p1": "B" }, fr: { "s1.p0": "A", "s1.p1": "B" }, ja: { "s1.p0": "あ" }, es: { "s1.p0": "A", "s1.p1": "B" } };
  const f = [];
  const lists = paragraphLists(["s1.p0", "s1.p1"], tr, [{ locale: "ja", id: "s1.p1" }], f, "s1 paragraphs");
  ok(f.length === 0 && lists.ja.length === 1 && lists.en.length === 2, "drop one ja paragraph");
  const f2 = [];
  paragraphLists(["s1.p0"], { en: { "s1.p0": "A" }, de: {}, fr: {}, ja: {}, es: {} }, [{ locale: "ja", id: "s1.p0" }], f2, "s1 paragraphs");
  ok(f2.length === 1, "dropping the only paragraph fails the post");
}

// Leading zeros: "07:00" may become 7時 / 7 h.
ok(validateBlogTranslation("Pick-up is at 07:00.", "お迎えは7時です。", "ja").ok, "ja 07:00 → 7時");

// Limiter: never more than `max` in flight, FIFO start order, results keep input order, errors isolated.
{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lim = createLimiter(3);
  let inFlight = 0;
  let peak = 0;
  const started = [];
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      lim.run(async () => {
        started.push(i);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await sleep(5 + ((i * 7) % 11));
        inFlight -= 1;
        return i * 10;
      }),
    ),
  );
  ok(peak === 3 && lim.peak === 3, "limiter caps concurrency at 3");
  ok(started.join(",") === [...Array(12).keys()].join(","), "limiter starts tasks FIFO");
  ok(results.join(",") === [...Array(12).keys()].map((i) => i * 10).join(","), "limiter results in input order");
  const settled = await Promise.allSettled([
    lim.run(async () => {
      throw new Error("boom");
    }),
    lim.run(async () => "fine"),
  ]);
  ok(settled[0].status === "rejected" && settled[1].value === "fine" && lim.active === 0, "limiter isolates errors and frees slots");
  const mapped = await mapLimit([30, 1, 20, 2], 2, async (ms, i) => {
    await sleep(ms);
    return `#${i}`;
  });
  ok(mapped.join(",") === "#0,#1,#2,#3", "mapLimit keeps order when later items finish first");
}

// Per-language models: every language has a primary and a second model for the ladder.
for (const l of ["de", "fr", "ja", "es"])
  ok(translateModelsFor(l).length >= 2, `models for ${l}`);

// translateStrings (mock backend): locales run concurrently, output order is deterministic.
{
  const prev = process.env.BLOG_AI_MOCK;
  process.env.BLOG_AI_MOCK = "1";
  const strings = { title: "Day trips from Tashkent", "s0.p0": "The drive takes 90 minutes.", "s0.p1": "Bring a jacket.", q0: "When to go?" };
  const r1 = await translateStrings(strings, "test");
  const r2 = await translateStrings(strings, "test");
  ok(Object.keys(r1.out).join(",") === "en,de,fr,ja,es", "locale order");
  for (const l of ["de", "fr", "ja", "es"])
    ok(Object.keys(r1.out[l]).join(",") === Object.keys(strings).join(","), `field order ${l}`);
  ok(JSON.stringify(r1) === JSON.stringify(r2), "same input → identical output");
  ok(r1.failures.length === 0 && r1.dropped.length === 0, "mock translation passes gates");
  if (prev === undefined) delete process.env.BLOG_AI_MOCK;
  else process.env.BLOG_AI_MOCK = prev;
}

// Run 41002782833 (2026-10-30): exact strings from the log.
ok(
  validateBlogTranslation(
    "Return to Tashkent hotels is usually between 5:30 and 6:30 p.m., depending on gondola queues.",
    "Le retour aux hôtels de Tachkent se fait généralement entre 17 h 30 et 18 h 30, selon les files d'attente pour le téléphérique.",
    "fr",
  ).ok,
  "fr 5:30 and 6:30 p.m. → 17 h 30 et 18 h 30",
);
ok(
  validateBlogTranslation(
    "Concierge support runs 24/7, helpful if train schedules shift.",
    "コンシェルジュサポートは24時間365日対応で、列車の時刻表が変更になった場合に役立ちます。",
    "ja",
  ).ok,
  "ja 24/7 → 24時間365日",
);
{
  const visaEn =
    "English-speaking driver support runs throughout the three sightseeing days, and 24/7 local concierge assistance handles restaurant reservations. No other companies, booking platforms or third parties are involved in your trip. Book early for May.";
  const cleaned = withoutRuleSentences(visaEn);
  ok(!/third parties/.test(cleaned) && /concierge/.test(cleaned) && /Book early/.test(cleaned), "English rule-echo sentence removed");
  ok(withoutRuleSentences("Plain sentence. Another.") === "Plain sentence. Another.", "clean English untouched");
}
ok(
  wordingProblems({ sections: [{ paragraphs: { fr: ["Une polaire intermédiaire et les saisons intermédiaires."] } }] }).length === 0,
  "post gate accepts adjectival intermédiaire",
);
ok(
  wordingProblems({ sections: [{ paragraphs: { fr: ["Nous passons par un intermédiaire."] } }] }).length === 1,
  "post gate still rejects un intermédiaire",
);

console.log(`blog translate checks: ${n} passed`);
