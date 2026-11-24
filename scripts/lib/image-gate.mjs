/**
 * Image gates for every photo the site adds (blog, destination, package).
 *
 * Hard rule from the owner: no logo, watermark, overlaid text, caption,
 * signage-dominated frame or border. Two layers:
 *   1. metadataProblems(): cheap pre-filter on titles, categories, tags and descriptions.
 *   2. visionGate(): a small (≈512px) copy goes to the NVIDIA vision-language
 *      model, which must answer strict JSON. Any flag, a non-photo, a subject
 *      mismatch, an unparseable reply or a failed call rejects the image (fail closed).
 */
import sharp from "sharp";
import { vision as nvidiaVision, VISION_MODEL } from "./blog-ai-client.mjs";

export { VISION_MODEL };
export const GATE_EDGE = 512;

/** Words in Commons categories / titles / tags that mean the file is not a clean travel photo. */
export const METADATA_REJECT_RE =
  /\b(watermark(?:ed|s)?|logos?|logotypes?|text(?:s| overlay)?|captions?|caption(?:ed)?|signage|signs?|sign ?boards?|stitch(?:ing)? errors?|billboards?|posters?|banners?|infographics?|screenshots?|icons?|maps?|map data|locator|diagrams?|charts?|graphs?|plans?|floor plans?|drawings?|illustrations?|coats? of arms|flags? of|emblems?|seals? of|stamps? of|postage stamps?|banknotes?|coins?|signatures?|scans?|scanned|documents?|book pages?|frames?|bordered|borders added|with borders?|collages?|montages?|portraits?|selfies?|headshots?|mugshots?|passport photos?|people of|men of|women of|children of|groups? of people|crowds?|faces?)\b/i;

/** Categories that are about the file itself and contain the words above harmlessly. */
const METADATA_ALLOW_RE =
  /\b(Images with annotations|Files with no machine-readable|Media missing infobox|CC-BY|CC-Zero|PD-|Self-published|Quality images|Featured pictures|Valued images|Photographs taken on|Taken with|Files from .* Flickr stream|Flickr images reviewed|uploaded by|Uploaded with|derivative versions|Retouched pictures|Pages with maps|Files with coordinates|Media with locations|Files with geocoordinates|Files by User|Photos by)\b/i;

/**
 * Reasons a candidate must be skipped based on metadata alone.
 * `cand` fields used: title, categories[], tags[], description.
 */
export function metadataProblems(cand) {
  const problems = [];
  const fields = [
    ["title", [String(cand.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_-]+/g, " ")]],
    ["category", (cand.categories ?? []).map((c) => String(c).replace(/^Category:/, ""))],
    ["tag", cand.tags ?? []],
    ["description", [String(cand.description ?? "")]],
  ];
  for (const [kind, values] of fields) {
    for (const v of values) {
      if (!v || (kind === "category" && METADATA_ALLOW_RE.test(v))) continue;
      const m = v.match(METADATA_REJECT_RE);
      // Descriptions often mention "map" or "plan" casually; only reject the strong words there.
      if (m && (kind !== "description" || /watermark|logo|caption|text overlay|screenshot|infographic|collage|montage|border/i.test(m[0]))) {
        problems.push(`${kind} "${v.slice(0, 60)}" matches "${m[0]}"`);
        break;
      }
    }
  }
  return problems;
}

export function gatePrompt(subject) {
  // Kept short on purpose: every token is paid per image.
  return [
    "Strict travel-photo check. Reply with ONLY this JSON, no prose:",
    '{"has_text":bool,"has_logo":bool,"has_watermark":bool,"has_border":bool,"is_photo":bool,"matches_subject":bool,"alt":"","reason":""}',
    "has_text: overlaid text/caption/date/URL, or signs/posters/printed text dominate the frame (historic carved calligraphy is fine).",
    "has_logo: any visible brand logo. has_watermark: any watermark, stamp or signature, corners included. has_border: frame, border, bars, collage.",
    "is_photo: real camera photo (not map, drawing, render, graphic).",
    `matches_subject: plausibly shows ${subject ? JSON.stringify(subject) : "a travel scene"}.`,
    "alt: one factual sentence, max 100 chars, naming the place if it matches. reason: max 8 words.",
  ].join("\n");
}

const FLAGS = ["has_text", "has_logo", "has_watermark", "has_border"];

/** Parse the model reply. Throws on anything that is not a JSON object with all booleans. */
export function parseGateVerdict(text) {
  const raw = String(text ?? "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in vision reply");
  const obj = JSON.parse(raw.slice(start, end + 1));
  for (const k of [...FLAGS, "is_photo", "matches_subject"]) {
    if (typeof obj[k] !== "boolean") throw new Error(`vision reply field ${k} is not boolean`);
  }
  return obj;
}

/** Pure decision from a parsed verdict. */
export function gateDecision(verdict, { requireSubject = true } = {}) {
  const reasons = [];
  for (const k of FLAGS) if (verdict[k] === true) reasons.push(k);
  if (verdict.is_photo !== true) reasons.push("not a photo");
  if (requireSubject && verdict.matches_subject !== true) reasons.push("subject mismatch");
  return {
    ok: reasons.length === 0,
    reasons: reasons.length && verdict.reason ? [...reasons, String(verdict.reason).slice(0, 160)] : reasons,
    alt: typeof verdict.alt === "string" ? verdict.alt.trim().slice(0, 160) : "",
    verdict,
  };
}

/** ≈512px JPEG data URL for the vision model. */
export async function downscaleForGate(buffer, edge = GATE_EDGE) {
  const out = await sharp(buffer)
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/**
 * Run the vision gate. Fails closed: any error, timeout or malformed reply → ok:false.
 * `call(prompt, dataUrl)` is injectable for tests; defaults to the NVIDIA VL model.
 */
export async function visionGate(buffer, { subject, requireSubject = Boolean(subject), call = nvidiaVision, edge = GATE_EDGE } = {}) {
  try {
    const dataUrl = await downscaleForGate(buffer, edge);
    const reply = await call(gatePrompt(subject), dataUrl);
    return gateDecision(parseGateVerdict(reply), { requireSubject });
  } catch (err) {
    return { ok: false, reasons: [`vision gate failed closed: ${String(err?.message || err).slice(0, 160)}`], alt: "" };
  }
}
