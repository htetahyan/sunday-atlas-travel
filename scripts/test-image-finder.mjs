#!/usr/bin/env node
/**
 * Unit tests for the image finder, vision gate, pHash, registry and uploader.
 * Offline by default (mocked model and network). `--live` also sends the three
 * fixtures in scripts/fixtures/image-gate to the real NVIDIA vision model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  normaliseLicense, shapeProblems, rankCandidates, relevance, commonsCandidate, findImage, stripHtml, queriesFor, enabledSources,
  qualityTier, resolutionBand, commonsThumb, searchCommons, cachedVerdict, cachedRejectApplies, COMMONS_ASSESSED,
} from "./lib/image-finder.mjs";
import { metadataProblems, parseGateVerdict, gateDecision, visionGate, gatePrompt } from "./lib/image-gate.mjs";
import { phash, hamming, phashFromPixels } from "./lib/phash.mjs";
import { duplicateOf, upsert, clearUses, reservedFor, parseCredits, sourceForExisting, cloudinaryPublicId, collectSiteImages, duplicateGroups } from "./lib/image-registry.mjs";
import { signParams, uploadImage, uploadStatus, cloudinaryConfig, safePublicName } from "./lib/cloudinary-upload.mjs";
import { heroPlace, pickPostImages } from "./lib/blog-images.mjs";
import { planSlots, ownerOf, placesFromDayTitle, placesFromHighlight, auditExisting, auditTitle } from "./images-for-packages.mjs";

let n = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  n += 1;
};
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  n += 1;
};
const FIX = "scripts/fixtures/image-gate";
const fixture = (name) => readFileSync(`${FIX}/${name}.jpg`);

/* licences */
eq(normaliseLicense("CC0"), { id: "CC0", requiresCredit: false }, "CC0");
eq(normaliseLicense("Public domain"), { id: "Public domain", requiresCredit: false }, "PD");
eq(normaliseLicense("CC BY 2.0", "https://creativecommons.org/licenses/by/2.0"), { id: "CC BY 2.0", requiresCredit: true }, "CC BY");
eq(normaliseLicense("CC BY-SA 4.0"), { id: "CC BY-SA 4.0", requiresCredit: true }, "CC BY-SA");
eq(normaliseLicense("CC BY-NC-SA 2.0"), null, "NC rejected");
eq(normaliseLicense("CC BY-ND 4.0"), null, "ND rejected");
eq(normaliseLicense("GFDL"), null, "GFDL-only rejected");
eq(normaliseLicense("All rights reserved"), null, "ARR rejected");
eq(stripHtml('<a href="x">Gustavo &amp; Co</a> from <b>Spain</b>'), "Gustavo & Co from Spain", "artist html stripped");

/* shape */
const base = { mime: "image/jpeg", width: 4000, height: 2667, license: "CC BY-SA 4.0" };
eq(shapeProblems(base), [], "landscape 4000 ok");
ok(shapeProblems({ ...base, width: 1600, height: 1067 }).some((p) => p.startsWith("long edge")), "long edge < 2000 rejected");
ok(shapeProblems({ ...base, width: 2100, height: 900 }).some((p) => / MP < 2 MP/.test(p)), "under 2 MP rejected");
eq(shapeProblems({ ...base, width: 2400, height: 1600 }), [], "3:2 at 2400×1600 ok");
ok(shapeProblems({ ...base, mime: "image/png" }).some((p) => p.startsWith("format")), "PNG graphics rejected");
ok(shapeProblems({ ...base, mime: "image/svg+xml" }).some((p) => p.startsWith("format")), "SVG rejected");
ok(shapeProblems({ ...base, width: 2000, height: 3000 }).some((p) => p.startsWith("not landscape")), "portrait rejected");
ok(shapeProblems({ ...base, width: 2000, height: 1900 }).some((p) => p.startsWith("not landscape")), "square-ish rejected");
ok(shapeProblems({ ...base, license: null }).includes("licence not allowed"), "licence required");

/* metadata pre-filter */
eq(metadataProblems({ title: "File:Registan Samarkand sunrise.jpg", categories: ["Registan", "Images with annotations", "CC-BY-2.0"] }), [], "clean metadata passes");
ok(metadataProblems({ title: "File:Uzbekistan Airways logo.png", categories: [] }).length, "logo title rejected");
ok(metadataProblems({ title: "File:Samarkand.jpg", categories: ["Maps of Samarkand"] }).length, "map category rejected");
ok(metadataProblems({ title: "File:x.jpg", categories: ["Watermarked images"] }).length, "watermark category rejected");
ok(metadataProblems({ title: "File:x.jpg", categories: ["People of Uzbekistan"] }).length, "people category rejected");
ok(metadataProblems({ title: "File:x.jpg", categories: ["Text in Uzbek"] }).length, "text category rejected");
ok(metadataProblems({ title: "File:Welcome sign Bukhara.jpg", categories: [] }).length, "sign title rejected");
ok(metadataProblems({ title: "File:x.jpg", categories: ["Posters in Tashkent"] }).length, "poster category rejected");
ok(metadataProblems({ title: "File:x.jpg", categories: ["Panoramics with stitching errors"] }).length, "stitch-error category rejected");
ok(metadataProblems({ title: "File:x.jpg", description: "Photo with a text overlay of the date" }).length, "text overlay description rejected");
eq(metadataProblems({ title: "File:x.jpg", description: "View towards the map room of the museum" }), [], "casual 'map' in description allowed");

/* ranking */
const c1 = { title: "File:Registan at dusk.jpg", categories: ["Registan", "Samarkand"], width: 4000, height: 2600, description: "" };
const c2 = { title: "File:Some street.jpg", categories: ["Streets in Samarkand"], width: 5000, height: 3000, description: "" };
const c3 = { title: "File:Registan 1911 Prokudin-Gorsky.jpg", categories: ["Registan"], width: 4000, height: 2600, description: "" };
ok(relevance(c1, { place: "Registan", country: "Uzbekistan" }) > 0, "place in title scores");
eq(relevance(c2, { place: "Registan" }), 0, "place missing scores 0");
ok(relevance(c1, { place: "Registan" }) > relevance(c3, { place: "Registan" }), "historical photo ranked lower");
eq(rankCandidates([c3, c2, c1].map((c) => ({ ...c, mime: "image/jpeg", license: "CC0" })), { place: "Registan" }).map((c) => c.title)[0], c1.title, "best candidate first");
/* quality tiers and ranking order: tier, then resolution band, then relevance */
eq(qualityTier({ categories: ["Featured pictures on Wikimedia Commons"] }), 3, "Featured = tier 3");
eq(qualityTier({ categories: ["Quality images of Uzbekistan"] }), 2, "Quality = tier 2");
eq(qualityTier({ categories: [], assessments: ["valued"] }), 1, "Valued (assessment) = tier 1");
eq(qualityTier({ categories: ["Registan"] }), 0, "unassessed = tier 0");
eq([resolutionBand({ width: 4500, height: 3000 }), resolutionBand({ width: 3000, height: 2000 }), resolutionBand({ width: 2400, height: 1600 })], [2, 1, 0], "resolution bands");
const rk = (t, extra) => ({ title: `File:${t}.jpg`, categories: ["Registan"], description: "", mime: "image/jpeg", license: "CC0", width: 3000, height: 2000, ...extra });
eq(
  rankCandidates([rk("Registan big", { width: 6000, height: 4000 }), rk("Registan QI", { categories: ["Registan", "Quality images"] }), rk("Registan FP", { categories: ["Registan", "Featured pictures on Wikimedia Commons"], width: 2400, height: 1600 })], { place: "Registan" }).map((c) => c.title),
  ["File:Registan FP.jpg", "File:Registan QI.jpg", "File:Registan big.jpg"],
  "Featured > Quality > bigger unassessed",
);
eq(
  rankCandidates([rk("Registan Samarkand Uzbekistan small"), rk("Registan big", { width: 6000, height: 4000 })], { place: "Registan", country: "Uzbekistan" }).map((c) => c.title)[0],
  "File:Registan big.jpg",
  "same tier: resolution band before relevance",
);
eq(commonsThumb("https://upload.wikimedia.org/wikipedia/commons/a/ab/Registan_1.jpg"), "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Registan_1.jpg/500px-Registan_1.jpg", "Commons 500px preview URL");
eq(commonsThumb("https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Registan_01.jpg/1920px-Registan_01.jpg?utm_source=x"), "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Registan_01.jpg/500px-Registan_01.jpg", "preview from the 1920 thumb, query dropped");
let searchedUrl = "";
await searchCommons("Registan", { assessed: true, fetchImpl: async (u) => ((searchedUrl = String(u)), new Response(JSON.stringify({ query: { pages: {} } }))) });
ok(new URL(searchedUrl).searchParams.get("gsrsearch").includes(COMMONS_ASSESSED) && /filew:>1999/.test(new URL(searchedUrl).searchParams.get("gsrsearch")), "assessed Commons search: FP/QI categories, width ≥ 2000");
ok(/Assessments/.test(new URL(searchedUrl).searchParams.get("iiextmetadatafilter")), "asks Commons for assessments");
eq(queriesFor({ place: "Registan", country: "Uzbekistan" }), ["Registan Uzbekistan", "Registan"], "queries most specific first");
eq(enabledSources({}), ["commons"], "Commons only without keys");
eq(enabledSources({ PEXELS_API_KEY: "x", UNSPLASH_ACCESS_KEY: "y" }), ["commons", "pexels", "unsplash"], "Pexels/Unsplash switch on with keys");
const cc = commonsCandidate({
  pageid: 1,
  title: "File:A.jpg",
  imageinfo: [{ width: 3000, height: 2000, mime: "image/jpeg", url: "https://upload.wikimedia.org/wikipedia/commons/1/1a/A.jpg", thumburl: "https://u/t.jpg?utm=1", descriptionurl: "https://c/A", extmetadata: { LicenseShortName: { value: "CC BY-SA 3.0" }, Artist: { value: "<a>Jane</a>" }, Categories: { value: "Registan|Samarkand" }, Assessments: { value: "quality" } } }],
});
eq([cc.key, cc.license, cc.author, cc.requiresCredit, cc.downloadUrl], ["commons:1", "CC BY-SA 3.0", "Jane", true, "https://u/t.jpg?utm=1"], "Commons candidate normalised (1920 thumb)");
eq([cc.previewUrl, qualityTier(cc)], ["https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/A.jpg/500px-A.jpg", 2], "Commons candidate: 500px preview + assessment tier");

/* pHash */
const clean = fixture("clean-landscape");
const hClean = await phash(clean);
const hSmall = await phash(await sharp(clean).resize(300).jpeg({ quality: 50 }).toBuffer());
const hBright = await phash(await sharp(clean).modulate({ brightness: 1.1 }).toBuffer());
const hFlip = await phash(await sharp(clean).flop().toBuffer());
const hOther = await phash(await sharp({ create: { width: 400, height: 300, channels: 3, background: "#808080" } }).composite([{ input: Buffer.from('<svg width="400" height="300"><rect x="0" y="0" width="200" height="300" fill="black"/></svg>') }]).png().toBuffer());
ok(/^[0-9a-f]{16}$/.test(hClean), "pHash is 16 hex chars");
eq(hamming(hClean, hClean), 0, "same image distance 0");
ok(hamming(hClean, hSmall) <= 6, `resized+recompressed is near-duplicate (${hamming(hClean, hSmall)})`);
ok(hamming(hClean, hBright) <= 6, `brightened is near-duplicate (${hamming(hClean, hBright)})`);
ok(hamming(hClean, hFlip) > 6, `mirrored is a different image (${hamming(hClean, hFlip)})`);
ok(hamming(hClean, hOther) > 6, `unrelated image is far (${hamming(hClean, hOther)})`);
eq(hamming("ff", "0"), Infinity, "length mismatch is Infinity");
const grad = Array.from({ length: 1024 }, (_, i) => (i % 32) * 8);
eq(phashFromPixels(grad), phashFromPixels([...grad]), "pHash is deterministic");
assert.throws(() => phashFromPixels([1, 2, 3]), /1024/);
n += 1;

/* registry */
const reg = { images: [] };
upsert(reg, { key: "commons:1", phash: hClean, cloudinary: { url: "https://res.cloudinary.com/di4a4oz3o/image/upload/v1/a.jpg" }, uses: [{ type: "blog", slug: "a", field: "heroImage" }] });
upsert(reg, { key: "commons:2", phash: hFlip, cloudinary: { url: "https://res.cloudinary.com/di4a4oz3o/image/upload/v1/b.jpg" }, uses: [] });
eq(duplicateOf(reg, { key: "commons:1", phash: hOther })?.why, "same source", "same source id rejected");
ok(/near-duplicate/.test(duplicateOf(reg, { key: "commons:9", phash: hSmall })?.why ?? ""), "near-duplicate rejected");
eq(duplicateOf(reg, { key: "commons:9", phash: hOther }), null, "different image accepted");
eq(duplicateOf(reg, { key: "commons:2", phash: hFlip }), null, "reserved (unused) upload does not block");
ok(reservedFor(reg, "commons:2"), "reserved upload found for reuse");
eq(duplicateOf(reg, { key: "commons:1", phash: hClean }, { ignoreUse: { type: "blog", slug: "a" } }), null, "a page's own image is ignored on re-check");
clearUses(reg, "blog", "a");
eq(duplicateOf(reg, { key: "commons:1", phash: hClean }), null, "clearUses frees the image");
eq(cloudinaryPublicId("https://res.cloudinary.com/di4a4oz3o/image/upload/v1792317592/sunday-atlas/home_xqynbs.jpg"), "sunday-atlas/home_xqynbs", "public id from URL");
eq(cloudinaryPublicId("https://res.cloudinary.com/di4a4oz3o/image/upload/f_auto,q_auto/v12/sunday-atlas/x.jpg"), "sunday-atlas/x", "public id skips transforms");
eq(sourceForExisting("https://res.cloudinary.com/di4a4oz3o/image/upload/v1/sunday-atlas/registan-square-35220187_hm4jth.jpg").key, "pexels:35220187", "Pexels id from file name");
eq(sourceForExisting("https://res.cloudinary.com/di4a4oz3o/image/upload/v1/sunday-atlas/zxw.jpg").key, "cloudinary:sunday-atlas/zxw", "unknown source keyed by public id");
const credits = parseCredits(readFileSync("public/images/CREDITS.md", "utf8"));
ok(credits.size >= 20, `CREDITS.md parsed (${credits.size})`);
const site = collectSiteImages();
ok(site.length > 100 && site.some((s) => s.use.type === "blog") && site.some((s) => s.use.field.startsWith("gallery")), `site images collected (${site.length})`);
const committed = JSON.parse(readFileSync("content/image-registry.json", "utf8"));
ok(committed.images.length >= 90 && committed.images.every((e) => /^[0-9a-f]{16}$/.test(e.phash ?? "")), "committed registry has a pHash for every image");
ok(committed.images.filter((e) => e.uses?.length).every((e) => e.cloudinary?.publicId || e.hotlink), "every image in use has a Cloudinary public_id");
ok(committed.images.filter((e) => !e.uses?.length).every((e) => e.gate && typeof e.gate.ok === "boolean"), "unused entries are cached vision verdicts");
ok(duplicateGroups(committed).length >= 1, "seeded registry finds the known Bhutan near-duplicates");

/* vision gate (offline) */
const good = '{"has_text":false,"has_logo":false,"has_watermark":false,"has_border":false,"is_photo":true,"matches_subject":true,"alt":"A lake","reason":""}';
eq(parseGateVerdict("```json\n" + good + "\n```").is_photo, true, "fenced JSON parsed");
assert.throws(() => parseGateVerdict('{"has_text":"no"}'), /not boolean/);
n += 1;
assert.throws(() => parseGateVerdict("I think it is fine"), /no JSON/);
n += 1;
eq(gateDecision(JSON.parse(good)).ok, true, "clean verdict passes");
for (const flag of ["has_text", "has_logo", "has_watermark", "has_border"])
  eq(gateDecision({ ...JSON.parse(good), [flag]: true }).ok, false, `${flag} rejects`);
eq(gateDecision({ ...JSON.parse(good), is_photo: false }).ok, false, "non-photo rejects");
eq(gateDecision({ ...JSON.parse(good), matches_subject: false }).ok, false, "subject mismatch rejects");
eq(gateDecision({ ...JSON.parse(good), matches_subject: false }, { requireSubject: false }).ok, true, "audit mode ignores subject");
ok(/has_watermark/.test(gatePrompt("Registan")) && /Registan/.test(gatePrompt("Registan")), "prompt asks for every flag and names the subject");
let sentEdge = 0;
const mockCall = (verdicts) => async (_prompt, dataUrl) => {
  const meta = await sharp(Buffer.from(dataUrl.split(",")[1], "base64")).metadata();
  sentEdge = Math.max(meta.width, meta.height);
  return verdicts;
};
eq((await visionGate(clean, { subject: "lake", call: mockCall(good) })).ok, true, "clean fixture passes with clean verdict");
ok(sentEdge <= 512 && sentEdge >= 480, `model gets a ≈512px copy (${sentEdge})`);
ok(gatePrompt("Registan").length < 900, `gate prompt is short (${gatePrompt("Registan").length} chars)`);
eq((await visionGate(fixture("text-overlay"), { subject: "lake", call: mockCall(good.replace('"has_text":false', '"has_text":true')) })).ok, false, "text fixture rejected");
eq((await visionGate(fixture("logo-corner"), { subject: "lake", call: mockCall(good.replace('"has_logo":false', '"has_logo":true')) })).ok, false, "logo fixture rejected");
const failed = await visionGate(clean, { call: async () => { throw new Error("HTTP 500"); } });
ok(!failed.ok && /failed closed/.test(failed.reasons[0]), "model error fails closed");
eq((await visionGate(clean, { call: async () => "not json" })).ok, false, "garbage reply fails closed");
eq((await visionGate(Buffer.from("not an image"), { call: mockCall(good) })).ok, false, "undecodable image fails closed");

/* Cloudinary */
eq(signParams({ eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: 1315060510 }, "abcd"), "bfd09f95f331f558cbd1320e67aa8d488770583e", "signature matches Cloudinary's documented example");
eq(uploadStatus({}).ok, false, "no credential → not ok");
ok(/CLOUDINARY_URL/.test(uploadStatus({}).missing), "missing secret is named");
eq(cloudinaryConfig({ CLOUDINARY_URL: "cloudinary://k:s@di4a4oz3o" }), { apiKey: "k", apiSecret: "s", cloudName: "di4a4oz3o" }, "CLOUDINARY_URL parsed");
eq(safePublicName("Gur-e Amir, Samarkand!"), "gur-e-amir-samarkand", "safe public id");
await assert.rejects(() => uploadImage(clean, { folder: "f", name: "x", env: {} }), /CLOUDINARY_URL/);
n += 1;
let sentForm;
const up = await uploadImage(clean, {
  folder: "sunday-atlas/blog/test",
  name: "Registan",
  context: { alt: "A|b" },
  env: { CLOUDINARY_URL: "cloudinary://k:s@di4a4oz3o" },
  fetchImpl: async (url, init) => {
    sentForm = { url, body: init.body };
    return new Response(JSON.stringify({ public_id: "sunday-atlas/blog/test/registan", secure_url: "https://res.cloudinary.com/di4a4oz3o/image/upload/v1/sunday-atlas/blog/test/registan.jpg", width: 768, height: 1152 }));
  },
});
eq(sentForm.url, "https://api.cloudinary.com/v1_1/di4a4oz3o/image/upload", "uploads to the site's cloud");
eq([sentForm.body.get("folder"), sentForm.body.get("public_id"), sentForm.body.get("context")], ["sunday-atlas/blog/test", "registan", "alt=A b"], "folder, id and context sent");
ok(/^[0-9a-f]{40}$/.test(sentForm.body.get("signature")) && !sentForm.body.has("api_secret"), "signed, secret never sent");
eq(up.publicId, "sunday-atlas/blog/test/registan", "upload result");

/* findImage pipeline (mocked network) */
const cand = (id, extra = {}) => ({ provider: "commons", key: `commons:${id}`, sourceId: String(id), title: `File:Registan ${id}.jpg`, width: 4000, height: 2600, mime: "image/jpeg", downloadUrl: `https://dl/${id}`, pageUrl: `https://c/${id}`, author: "A", license: "CC BY-SA 4.0", licenseUrl: "https://l", requiresCredit: true, categories: ["Registan"], description: "", tags: [], ...extra });
const textBuf = await sharp(fixture("text-overlay")).flip().toBuffer();
const hText = await phash(textBuf);
const imgs = { "https://dl/1": clean, "https://dl/2": await sharp(clean).resize(500).toBuffer(), "https://dl/3": textBuf, "https://dl/4": await sharp(clean).flop().toBuffer(), "https://dl/5": await sharp(clean).flip().toBuffer() };
const fetchImpl = async (url) => new Response(imgs[url]);
const preg = { images: [] };
upsert(preg, { key: "commons:1", phash: hClean, cloudinary: { url: "u1" }, uses: [{ type: "package", slug: "p", field: "image" }] });
const gateMock = async (buf) => ((await phash(buf)) === hText ? { ok: false, reasons: ["has_text"] } : { ok: true, reasons: [], alt: "Registan madrasas at dusk" });
let uploads = 0;
const r = await findImage({
  place: "Registan", country: "Uzbekistan", registry: preg, folder: "sunday-atlas/blog/t", use: { type: "blog", slug: "t", field: "heroImage" },
  env: { CLOUDINARY_URL: "cloudinary://k:s@di4a4oz3o" }, fetchImpl, gate: gateMock,
  upload: async (_b, o) => { uploads += 1; return { publicId: `${o.folder}/${o.name}`, url: `https://res.cloudinary.com/x/${o.name}.jpg`, width: 1920, height: 1248 }; },
  searchers: { commons: async () => [cand(1), cand(2), cand(6, { title: "File:Uzbekistan logo.png" }), cand(3), cand(4)] },
});
eq(r.ok, true, "finder found an image");
eq(r.image.key, "commons:4", "skips same source, near-duplicate, logo metadata and text-overlay, picks the clean new photo");
eq(r.tried.map((t) => t.key), ["commons:1", "commons:6", "commons:2", "commons:3"], "metadata rejections first (no download), then preview checks");
ok(/same source/.test(r.tried[0].reject) && /logo/.test(r.tried[1].reject) && /near-duplicate/.test(r.tried[2].reject) && /vision/.test(r.tried[3].reject), "rejection reasons");
eq(r.visionCalls, 2, "2 vision calls (text reject, then pass)");
eq(cachedVerdict(preg, "commons:3")?.reasons, ["has_text"], "vision reject cached in the registry");
eq(uploads, 1, "only the chosen image is uploaded");
eq(preg.images.find((e) => e.key === "commons:4").uses, [{ type: "blog", slug: "t", field: "heroImage" }], "registered with its use");
eq(r.image.credit.required, true, "CC BY-SA credit marked required");
eq(r.image.altEn, "Registan madrasas at dusk", "alt text from the vision model");
const none = await findImage({ place: "Registan", registry: preg, env: {}, fetchImpl, gate: gateMock, searchers: { commons: async () => [cand(5)] } });
ok(!none.ok && /CLOUDINARY_URL/.test(none.reasons[0]), "no upload credential → reports the missing secret");
const dry = await findImage({ place: "Registan", registry: preg, env: {}, dryRun: true, fetchImpl, gate: gateMock, searchers: { commons: async () => [cand(5)] } });
ok(dry.ok && dry.image.src === "https://c/5" && !(preg.images.find((e) => e.key === "commons:5")?.uses ?? []).length, "dry run suggests without uploading or registering a use");
eq(cachedVerdict(preg, "commons:5")?.ok, true, "dry run still caches the verdict");

/* spend controls: cache, 2 finalists per slot, per-post budget */
let gateCalls = 0;
let downloads = 0;
const countingGate = async (buf, o) => ((gateCalls += 1), gateMock(buf, o));
const countingFetch = async (u) => ((downloads += 1), fetchImpl(u));
const again = await findImage({ place: "Registan", registry: preg, env: {}, dryRun: true, fetchImpl: countingFetch, gate: countingGate, searchers: { commons: async () => [cand(3), cand(5)] } });
ok(again.ok && again.image.key === "commons:5", "cached pass reused");
eq([gateCalls, again.visionCalls, downloads], [0, 0, 1], "cached reject skipped before download; cached pass needs no vision call");
ok(/cached vision reject/.test(again.tried[0].reject), "cached reject logged");
const rejAll = async () => ((gateCalls += 1), { ok: false, reasons: ["has_logo"] });
gateCalls = 0;
const imgs2 = { "https://dl/11": await sharp(clean).rotate(90).resize(600, 400, { fit: "fill" }).toBuffer(), "https://dl/12": await sharp(fixture("logo-corner")).resize(600, 400, { fit: "fill" }).toBuffer(), "https://dl/13": await sharp(fixture("text-overlay")).flop().resize(600, 400, { fit: "fill" }).toBuffer() };
const f2 = async (u) => new Response(imgs2[u]);
const two = await findImage({ place: "Registan", registry: { images: [] }, env: {}, dryRun: true, fetchImpl: f2, gate: rejAll, searchers: { commons: async () => [cand(11), cand(12), cand(13)] } });
eq([two.ok, gateCalls, two.visionCalls], [false, 2, 2], "only the top 2 finalists per slot reach the vision gate");
gateCalls = 0;
const budget = { limit: 3, used: 2 };
const capped = await findImage({ place: "Registan", registry: { images: [] }, env: {}, dryRun: true, fetchImpl: f2, gate: rejAll, budget, searchers: { commons: async () => [cand(11), cand(12), cand(13)] } });
eq([gateCalls, budget.used], [1, 3], "shared per-post budget caps vision calls");
ok(capped.tried.some((t) => /vision budget used/.test(t.reject)), "budget stop is logged");
const flaky = { images: [] };
await findImage({ place: "Registan", registry: flaky, env: {}, dryRun: true, fetchImpl: f2, gate: async () => ({ ok: false, reasons: ["vision gate failed closed: HTTP 500"] }), searchers: { commons: async () => [cand(11)] } });
eq(cachedVerdict(flaky, "commons:11"), null, "failed-closed calls are not cached (retried next time)");
ok(cachedRejectApplies({ ok: false, reasons: ["has_text", "x"] }, "Other"), "flag reject applies to any subject");
ok(!cachedRejectApplies({ ok: false, reasons: ["subject mismatch", "shows a lake"], subject: "Registan" }, "Lake Sevan"), "subject-only reject does not block another subject");
ok(cachedRejectApplies({ ok: false, reasons: ["subject mismatch"], subject: "Registan" }, "Registan"), "subject-only reject blocks the same subject");

/* blog wiring */
eq(heroPlace("things to do in Tashkent"), "Tashkent", "hero place: things to do");
eq(heroPlace("best time to visit Uzbekistan"), "Uzbekistan", "hero place: best time");
eq(heroPlace("Chimgan Mountains and Charvak Lake day trip from Tashkent"), "Chimgan Mountains and Charvak Lake", "hero place: day trip");
eq(heroPlace("day trip from Tashkent to Samarkand by train"), "Samarkand", "hero place: route");
eq(heroPlace("uzbekistan itinerary 5 days"), "uzbekistan", "hero place: itinerary");
const calls = [];
const picked = await pickPostImages({
  slug: "s", keyword: "things to do in Tashkent", country: "Uzbekistan", registry: { images: [] },
  sections: [{ id: "chorsu", placeName: "Chorsu Bazaar" }, { id: "metro", placeName: "Tashkent Metro" }, { id: "x", placeName: "Nowhere" }],
  finder: async (o) => {
    calls.push(`${o.use.field}:${o.place}:${o.folder}`);
    return o.place === "Nowhere" ? { ok: false, reasons: ["none"] } : { ok: true, image: { key: o.place, src: o.place, altEn: o.place } };
  },
});
eq([picked.hero?.key, picked.inline.map((i) => i?.key ?? null)], ["Tashkent", ["Chorsu Bazaar", "Tashkent Metro", null]], "hero + inline per section, null when nothing found");
ok(calls.every((c) => c.endsWith(":sunday-atlas/blog/s")), "uploads go to sunday-atlas/blog/<slug>");
eq(calls.indexOf("heroImage:Tashkent:sunday-atlas/blog/s"), 0, "hero searched first");
let seenBudget = null;
const pb = await pickPostImages({ slug: "s", keyword: "Tashkent", country: "Uzbekistan", registry: { images: [] }, sections: [{ id: "a", placeName: "A" }, { id: "b", placeName: "B" }], env: {},
  finder: async (o) => ((seenBudget ??= o.budget), (o.budget.used += 2), { ok: true, image: { key: o.place } }) });
eq([seenBudget.limit, pb.visionCalls], [12, 6], "one 12-call vision budget shared by every slot of a post");
ok(pb.log.includes("vision calls: 6/12"), "vision call count logged");

/* packages script */
eq(placesFromDayTitle("Almaty – Charyn Canyon – Kolsay Lakes, 440 km by road"), ["Almaty", "Charyn Canyon", "Kolsay Lakes"], "places from day title");
eq(placesFromDayTitle("Samarkand – Shah-i-Zinda & Registan"), ["Samarkand", "Shah-i-Zinda", "Registan"], "hyphenated names kept");
eq(placesFromHighlight("Khiva: Ichan-Kala, a UNESCO World Heritage Site").map((p) => p.place), ["Ichan-Kala"], "places from highlight");
eq(ownerOf([{ type: "blog", slug: "b", field: "heroImage" }, { type: "destination", slug: "d", field: "gallery.0" }, { type: "package", slug: "p", field: "image" }]), { type: "package", slug: "p", field: "image" }, "main image owner wins");
const preg2 = { images: [{ key: "k1", phash: hClean, cloudinary: { url: "u1" }, uses: [{ type: "package", slug: "p", field: "image" }, { type: "destination", slug: "d", field: "gallery.0" }] }] };
const plan = planSlots([{ type: "destination", slug: "d", doc: { image: { src: "u2" }, gallery: [{ image: { src: "u1" } }] } }, { type: "package", slug: "p", doc: { image: { src: "u1" }, gallery: [] } }], preg2, 2);
eq(plan[0].needs.map((x) => x.field), ["gallery.0", "gallery.+1"], "destination: replace shared photo in place, fill gallery to 2");
eq(plan[1].needs.map((x) => x.field), ["gallery.+1", "gallery.+2"], "package keeps its main image, fills gallery");

/* audit: metadata + pHash only unless --vision */
const areg = { images: [
  { key: "pexels:1", source: { provider: "pexels" }, phash: hClean, cloudinary: { publicId: "sunday-atlas/registan-square-1_ab12cd", url: "https://res.cloudinary.com/di4a4oz3o/image/upload/v1/sunday-atlas/registan-square-1_ab12cd.jpg", width: 1600, height: 1067 }, uses: [{ type: "package", slug: "p", field: "image" }] },
  { key: "cloudinary:sunday-atlas/hotel-logo-sign", source: { provider: "unknown" }, phash: hOther, cloudinary: { publicId: "sunday-atlas/hotel-logo-sign", url: "https://res.cloudinary.com/di4a4oz3o/image/upload/v1/sunday-atlas/hotel-logo-sign.jpg", width: 3000, height: 2000 }, uses: [{ type: "destination", slug: "d", field: "gallery.0" }] },
] };
eq(auditTitle(areg.images[0]), "registan square", "audit title from Cloudinary file name");
let auditGate = 0;
const aud = await auditExisting(areg, { gate: async () => ((auditGate += 1), { ok: true, reasons: [] }), fetchImpl: async () => { throw new Error("no network expected"); } });
eq([aud.mode, auditGate, aud.vision], ["metadata+phash", 0, null], "default audit makes no vision calls");
eq(aud.metadata.map((m) => m.key), ["cloudinary:sunday-atlas/hotel-logo-sign"], "metadata audit flags logo/sign file names");
eq(aud.belowBar, 1, "audit counts images below the new 2000px / 2 MP bar");
const audV = await auditExisting(areg, { vision: true, gate: async () => ((auditGate += 1), { ok: false, reasons: ["has_text"] }), fetchImpl: async () => new Response(clean) });
eq([auditGate, audV.vision.calls, audV.vision.fails.length], [2, 2, 2], "--vision audits every image");
const audV2 = await auditExisting(areg, { vision: true, gate: async () => ((auditGate += 1), { ok: true, reasons: [] }), fetchImpl: async () => new Response(clean) });
eq([auditGate, audV2.vision.calls, audV2.vision.cached], [2, 0, 2], "audit verdicts cached: never checked twice");

/* live (optional): the real NVIDIA vision model on the three fixtures */
if (process.argv.includes("--live")) {
  if (!process.env.NVIDIA_API_KEY) throw new Error("--live needs NVIDIA_API_KEY");
  const live = {};
  for (const f of ["clean-landscape", "text-overlay", "logo-corner"]) live[f] = await visionGate(fixture(f), { subject: "mountain lake in Kyrgyzstan" });
  eq(live["clean-landscape"].ok, true, `live: clean landscape passes (${live["clean-landscape"].reasons})`);
  ok(!live["text-overlay"].ok && live["text-overlay"].verdict?.has_text === true, "live: text overlay rejected with has_text");
  ok(!live["logo-corner"].ok && live["logo-corner"].verdict?.has_logo === true, "live: logo rejected with has_logo");
  console.log(`  live gate: ${Object.entries(live).map(([k, v]) => `${k}=${v.ok ? "pass" : `reject(${v.reasons[0]})`}`).join(", ")}`);
}

console.log(`image finder checks: ${n} passed`);
