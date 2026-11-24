#!/usr/bin/env node
/**
 * Suggest (dry run, default) or fill (--apply) photos for destinations and
 * packages that have a missing hero, too few gallery photos, or photos that
 * another destination/package also uses. Same finder, vision gate and registry
 * as the daily blog job, so nothing repeats across the site.
 *
 *   node scripts/images-for-packages.mjs                 # dry run: report only
 *   node scripts/images-for-packages.mjs --audit         # also audit existing site images: metadata + pHash only (report only)
 *   node scripts/images-for-packages.mjs --audit --vision  # …plus the vision gate on each (spends tokens; verdicts cached)
 *   node scripts/images-for-packages.mjs --only=<slug>   # one destination or package
 *   node scripts/images-for-packages.mjs --apply         # upload + write content JSON (needs CLOUDINARY_URL)
 *   --min-gallery=4  --max-slots=<n>  --report=<file.json>
 *
 * --apply edits content/{destinations,packages}/*.json. Those files are pulled from
 * Sanity before each build, so applied changes must also be pushed to Sanity.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { findImage, enabledSources, shapeProblems, cachedVerdict } from "./lib/image-finder.mjs";
import { visionGate, metadataProblems, VISION_MODEL } from "./lib/image-gate.mjs";
import { uploadStatus } from "./lib/cloudinary-upload.mjs";
import { loadRegistry, saveRegistry, findBySrc, upsert, duplicateGroups } from "./lib/image-registry.mjs";
import { cldSmall } from "./lib/image-helpers.mjs";
import { mapLimit } from "./lib/blog-ai-client.mjs";
import { seedRegistry } from "./image-registry.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const APPLY = Boolean(args.apply);
const MIN_GALLERY = Number(args["min-gallery"] || 4);
const MAX_SLOTS = Number(args["max-slots"] || Infinity);
const PAGE_VISION_CAP = Number(process.env.IMAGE_FINDER_PAGE_VISION_CAP || 12);

const LOCALES = ["en", "de", "fr", "ja", "es"];
const DIRS = { destination: "content/destinations", package: "content/packages" };

/** "Almaty – Charyn Canyon – Kolsay Lakes, 440 km by road" → ["Charyn Canyon", "Kolsay Lakes", "Almaty"]. */
export function placesFromDayTitle(title) {
  return String(title ?? "")
    .replace(/,\s*\d[\d.,]*\s*km.*$/i, "")
    .replace(/\((?:[^)]*)\)/g, "")
    .split(/\s*(?:–|—|→|&|\/|,|\band\b)\s*|\s+-\s+/)
    .map((s) => s.replace(/\b(arrival|departure|transfer|free day|day trip|drive|by road|by train|flight|airport|hotel|city tour|check[- ]?out|land border)\b/gi, "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 3 && /\p{Lu}/u.test(s[0]));
}

/** "Samarkand: Registan, Gur-e Amir" → [{ place: "Registan", extra: "Samarkand" }, …]. */
export function placesFromHighlight(h) {
  const [head, rest] = String(h ?? "").split(/:\s*/, 2);
  if (!rest) return placesFromDayTitle(head).map((place) => ({ place, extra: "" }));
  return rest
    .split(/,\s*|\s+and\s+/)
    .map((p) => p.replace(/^(the|a)\s+/i, "").replace(/\b(?:a |the )?(?:plov master class|UNESCO World Heritage Site)\b/i, "").trim())
    .filter((p) => p.length >= 3 && /\p{Lu}/u.test(p[0]))
    .map((place) => ({ place, extra: head.trim() }));
}

function loadDocs() {
  const docs = [];
  for (const [type, dir] of Object.entries(DIRS))
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
      const doc = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
      docs.push({ type, slug: doc.slug || f.replace(/\.json$/, ""), file: `${dir}/${f}`, doc });
    }
  return docs;
}

/** Owner of a shared image: the page that uses it as its main image, else the first package, else the first destination. */
export function ownerOf(uses) {
  const pages = uses.filter((u) => u.type !== "blog");
  const main = pages.find((u) => u.field === "image");
  return main ?? pages.find((u) => u.type === "package") ?? pages[0];
}

/** Slots each page needs: hero, gallery shortfall, and replacements for photos owned by another page. */
export function planSlots(docs, reg, minGallery = MIN_GALLERY) {
  const plan = [];
  for (const d of docs) {
    const needs = [];
    if (!d.doc.image?.src) needs.push({ field: "image", why: "missing hero" });
    const gallery = d.doc.gallery ?? [];
    const dupFields = [];
    const check = (src, field) => {
      const e = findBySrc(reg, src);
      if (!e) return;
      const owner = ownerOf(e.uses ?? []);
      if (owner && !(owner.type === d.type && owner.slug === d.slug)) dupFields.push({ field, why: `same photo as ${owner.type}/${owner.slug}`, src });
      else if ((e.uses ?? []).filter((u) => u.type === d.type && u.slug === d.slug).length > 1 && field !== "image" && !field.startsWith("itinerary"))
        dupFields.push({ field, why: "repeated on this page", src });
    };
    if (d.doc.image?.src) check(d.doc.image.src, "image");
    gallery.forEach((g, i) => g.image?.src && check(g.image.src, `gallery.${i}`));
    needs.push(...dupFields);
    const usable = gallery.length - dupFields.filter((f) => f.field.startsWith("gallery")).length;
    for (let i = usable; i < minGallery; i += 1) if (i >= gallery.length) needs.push({ field: `gallery.+${i - gallery.length + 1}`, why: `gallery has ${gallery.length} (< ${minGallery})` });
    plan.push({ ...d, gallery: gallery.length, needs });
  }
  return plan;
}

function placesFor(d, destNames) {
  const country = d.type === "destination" ? d.doc.name?.en ?? d.slug : destNames.get(d.doc.destination) ?? d.doc.destination ?? "";
  const out = [];
  if (d.type === "package") {
    for (const day of d.doc.itinerary ?? []) for (const place of placesFromDayTitle(day.title?.en)) out.push({ place, extra: "" });
    for (const place of placesFromDayTitle(d.doc.title?.en)) out.push({ place, extra: "" });
  } else {
    for (const h of d.doc.highlights?.en ?? []) out.push(...placesFromHighlight(h));
  }
  out.push({ place: country, extra: "" });
  const seen = new Set();
  const places = out.filter((p) => p.place && !seen.has(p.place.toLowerCase()) && seen.add(p.place.toLowerCase()));
  return { country, places };
}

/** Title-ish text for an existing image: source title, else words from the Cloudinary file name. */
export function auditTitle(e) {
  if (e.source?.title) return e.source.title;
  const name = String(e.cloudinary?.publicId ?? e.key).split("/").pop();
  return name.replace(/_[a-z0-9]{6}$/, "").replace(/[-_]?\d+$/, "").replace(/[-_]+/g, " ").trim();
}

/**
 * Audit existing site images. Default: metadata + pHash only (no vision spend).
 * With `vision`, also run the gate on a ≈512px copy, reusing cached verdicts.
 */
export async function auditExisting(reg, { vision = false, gate = visionGate, fetchImpl = fetch } = {}) {
  const used = reg.images.filter((e) => (e.uses ?? []).length && (e.cloudinary?.url || e.hotlink));
  const pages = (e) => [...new Set(e.uses.map((u) => `${u.type}/${u.slug}`))];
  const metadata = [];
  const belowBar = [];
  for (const e of used) {
    const probs = metadataProblems({ title: auditTitle(e), categories: e.source?.categories ?? [], tags: [], description: "" });
    if (probs.length) metadata.push({ key: e.key, url: e.cloudinary?.url ?? e.hotlink, reasons: probs, uses: pages(e) });
    const w = e.cloudinary?.width;
    const h = e.cloudinary?.height;
    if (w && h) {
      const shape = shapeProblems({ width: w, height: h, mime: "image/jpeg", license: "known" });
      if (shape.length) belowBar.push({ key: e.key, size: `${w}×${h}`, reasons: shape });
    }
  }
  const duplicates = duplicateGroups(reg).map((g) => g.map((e) => ({ key: e.key, uses: pages(e) })));
  const fails = [];
  let visionCalls = 0;
  let cached = 0;
  if (vision) {
    await mapLimit(used, 4, async (e) => {
      let v = cachedVerdict(reg, e.key);
      if (v) cached += 1;
      else {
        const res = await fetchImpl(e.cloudinary?.url ? cldSmall(e.cloudinary.url, 512) : e.hotlink, { signal: AbortSignal.timeout(60_000) }).catch((err) => ({ ok: false, status: err.message }));
        if (!res.ok) v = { ok: false, reasons: [`download ${res.status}`] };
        else {
          visionCalls += 1;
          const r = await gate(Buffer.from(await res.arrayBuffer()), {});
          v = { model: VISION_MODEL, ok: r.ok, reasons: r.reasons, at: new Date().toISOString().slice(0, 10) };
          if (!r.reasons.some((x) => /failed closed/.test(x))) e.gate = v;
        }
      }
      if (!v.ok) fails.push({ key: e.key, url: e.cloudinary?.url ?? e.hotlink, reasons: v.reasons, uses: pages(e) });
    });
  }
  return { checked: used.length, mode: vision ? "metadata+phash+vision" : "metadata+phash", metadata, duplicates, belowBar: belowBar.length, belowBarExamples: belowBar.slice(0, 5), vision: vision ? { calls: visionCalls, cached, fails } : null, fails: [...metadata, ...(vision ? fails : [])] };
}

async function main() {
  const reg = loadRegistry();
  await seedRegistry({ reg });
  const docs = loadDocs().filter((d) => !args.only || d.slug === args.only);
  const destNames = new Map(loadDocs().filter((d) => d.type === "destination").map((d) => [d.slug, d.doc.name?.en ?? d.slug]));
  const up = uploadStatus();
  if (APPLY && !up.ok) {
    console.error(`❌ --apply needs a Cloudinary upload credential: ${up.missing}`);
    process.exit(2);
  }
  console.log(`[images:packages] ${APPLY ? "APPLY" : "dry run"}; sources=${enabledSources().join(",")}; upload=${up.ok ? "cloudinary" : `none (missing ${up.missing})`}`);
  const plan = planSlots(docs, reg);
  const work = structuredClone(reg); // dry-run picks reserve images here so suggestions never repeat
  const report = { mode: APPLY ? "apply" : "dry-run", minGallery: MIN_GALLERY, pages: [], totals: {} };
  let slots = 0;
  let totalVision = 0;
  for (const p of plan) {
    if (!p.needs.length) {
      report.pages.push({ type: p.type, slug: p.slug, gallery: p.gallery, needs: [] });
      continue;
    }
    const { country, places } = placesFor(p, destNames);
    const folder = `sunday-atlas/${p.type === "package" ? "packages" : "destinations"}/${p.slug}`;
    const out = { type: p.type, slug: p.slug, gallery: p.gallery, needs: [] };
    let pi = 0;
    const budget = { limit: PAGE_VISION_CAP, used: 0 };
    for (const need of p.needs) {
      if (slots >= MAX_SLOTS) {
        out.needs.push({ ...need, suggestion: null, note: "max-slots reached" });
        continue;
      }
      slots += 1;
      let found = null;
      const rejected = [];
      for (let tries = 0; tries < places.length && !found; tries += 1) {
        const { place, extra } = places[(pi + tries) % places.length];
        const r = await findImage({ place, country, extra, registry: work, folder, dryRun: !APPLY, budget, use: { type: p.type, slug: p.slug, field: need.field } });
        if (r.ok) {
          found = { place, ...r.image };
          pi = (pi + tries + 1) % places.length;
        } else rejected.push(`${place}: ${r.reasons[0]}`);
      }
      if (found && !APPLY)
        upsert(work, { key: found.key, phash: found.phash, uses: [{ type: p.type, slug: p.slug, field: need.field }] });
      out.needs.push({
        ...need,
        suggestion: found ? { place: found.place, key: found.key, tier: found.tier, source: found.src, width: found.width, height: found.height, alt: found.altEn, credit: found.credit } : null,
        ...(found ? {} : { rejected: rejected.slice(0, 3) }),
      });
      console.log(`  ${found ? "✓" : "✗"} ${p.type}/${p.slug} ${need.field} (${need.why}) → ${found ? `${found.key} "${found.place}"` : "nothing found"}`);
      if (APPLY && found) applyImage(p, need, found);
    }
    totalVision += budget.used;
    out.visionCalls = budget.used;
    if (budget.used) console.log(`    vision calls for ${p.type}/${p.slug}: ${budget.used}/${budget.limit}`);
    report.pages.push(out);
    if (budget.used) cacheVerdicts(); // saved after every page, so an interrupted run keeps its verdicts
  }
  cacheVerdicts();
  if (args.audit) {
    console.log(`[images:packages] auditing existing site images (${args.vision ? "metadata + pHash + vision" : "metadata + pHash, no vision calls"}; report only, nothing replaced)…`);
    report.audit = await auditExisting(reg, { vision: Boolean(args.vision) });
    totalVision += report.audit.vision?.calls ?? 0;
  }
  const needs = report.pages.flatMap((p) => p.needs);
  report.totals = {
    pages: report.pages.length,
    pagesNeedingWork: report.pages.filter((p) => p.needs.length).length,
    missingHero: needs.filter((n) => n.why === "missing hero").length,
    galleryShortfall: needs.filter((n) => n.why.startsWith("gallery has")).length,
    duplicates: needs.filter((n) => n.why.startsWith("same photo") || n.why.startsWith("repeated")).length,
    slots: needs.length,
    suggested: needs.filter((n) => n.suggestion).length,
    unfilled: needs.filter((n) => !n.suggestion).length,
    visionCalls: totalVision,
    ...(report.audit
      ? { auditChecked: report.audit.checked, auditMode: report.audit.mode, auditFlagged: report.audit.fails.length, auditDuplicateGroups: report.audit.duplicates.length, auditBelowQualityBar: report.audit.belowBar }
      : {}),
  };
  saveRegistry(reg); // verdict cache (and, with --apply, the new uses)
  if (APPLY) {
    for (const p of plan) if (p.dirty) writeFileSync(p.file, `${JSON.stringify(p.doc, null, 2)}\n`);
  }
  writeFileSync(String(args.report || "image-plan-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[images:packages] ${JSON.stringify(report.totals)}`);
  if (report.audit?.fails.length) for (const f of report.audit.fails) console.log(`  ⚑ ${f.key}: ${f.reasons.join("; ")} [${f.uses.join(", ")}]`);

  // Cache every vision verdict from this run (dry run included) so no file is checked twice.
  function cacheVerdicts() {
    for (const e of work.images) {
      if (!e.gate || e === reg.images.find((r) => r.key === e.key)) continue;
      const mine = reg.images.find((r) => r.key === e.key);
      if (mine) mine.gate = e.gate;
      else reg.images.push({ ...structuredClone(e), uses: [] });
    }
    saveRegistry(reg);
  }

  function applyImage(p, need, img) {
    const alt = Object.fromEntries(LOCALES.map((l) => [l, img.altEn])); // translated later by auto-translate
    const image = { src: img.src, width: img.width, height: img.height, ...(img.credit ? { credit: img.credit } : {}) };
    p.doc.gallery = p.doc.gallery ?? [];
    if (need.field === "image") p.doc.image = { ...image, alt };
    else if (/^gallery\.\d+$/.test(need.field)) p.doc.gallery[Number(need.field.split(".")[1])] = { image, alt };
    else p.doc.gallery.push({ image, alt });
    p.dirty = true;
    reg.images = work.images;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
