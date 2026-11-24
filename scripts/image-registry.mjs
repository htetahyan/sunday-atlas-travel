#!/usr/bin/env node
/**
 * Build or refresh content/image-registry.json from every blog, destination and
 * package image, and report duplicates.
 *
 *   node scripts/image-registry.mjs            # seed/refresh (downloads small copies to hash new images)
 *   node scripts/image-registry.mjs --report   # duplicates only, no network
 */
import { readFileSync, existsSync } from "node:fs";
import { phash } from "./lib/phash.mjs";
import {
  loadRegistry, saveRegistry, collectSiteImages, parseCredits, sourceForExisting,
  cloudinaryPublicId, duplicateGroups, PHASH_MAX_DISTANCE,
} from "./lib/image-registry.mjs";
import { mapLimit } from "./lib/blog-ai-client.mjs";
import { cldSmall } from "./lib/image-helpers.mjs";

const reportOnly = process.argv.includes("--report");

export async function seedRegistry({ reg = loadRegistry(), log = console.log } = {}) {
  const credits = parseCredits(existsSync("public/images/CREDITS.md") ? readFileSync("public/images/CREDITS.md", "utf8") : "");
  const refs = collectSiteImages();
  const bySrc = new Map();
  for (const r of refs) {
    if (!bySrc.has(r.src)) bySrc.set(r.src, { ...r, uses: [] });
    bySrc.get(r.src).uses.push(r.use);
  }
  // Uses are rebuilt from content every time; reserved uploads (no uses) are kept.
  for (const e of reg.images) e.uses = [];
  const known = new Map(reg.images.filter((e) => e.cloudinary?.url || e.hotlink).map((e) => [e.cloudinary?.url ?? e.hotlink, e]));
  let hashed = 0;
  await mapLimit([...bySrc.values()], 6, async (r) => {
    const prev = known.get(r.src);
    let hash = prev?.phash;
    if (!hash) {
      const res = await fetch(cldSmall(r.src), { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${r.src} HTTP ${res.status}`);
      hash = await phash(Buffer.from(await res.arrayBuffer()));
      hashed += 1;
    }
    const src = prev ? { key: prev.key, source: prev.source } : sourceForExisting(r.src, credits);
    let entry = reg.images.find((e) => e.key === src.key && (e.cloudinary?.url ?? e.hotlink) === r.src);
    if (!entry) {
      // Same source key behind two different Cloudinary uploads: keep both, suffix the key.
      const clash = reg.images.some((e) => e.key === src.key);
      entry = {
        key: clash ? `${src.key}#${cloudinaryPublicId(r.src)}` : src.key,
        source: src.source,
        phash: hash,
        cloudinary: { publicId: cloudinaryPublicId(r.src), url: r.src, width: r.width, height: r.height },
        uses: [],
      };
      reg.images.push(entry);
    }
    entry.phash = hash;
    entry.uses = r.uses;
  });
  log(`[images] ${bySrc.size} unique images in ${refs.length} references; hashed ${hashed} new.`);
  return reg;
}

export function duplicateReport(reg) {
  const lines = [];
  const multiUse = reg.images.filter((e) => new Set((e.uses ?? []).map((u) => `${u.type}:${u.slug}`)).size > 1);
  const sameSource = new Map();
  for (const e of reg.images) {
    const k = e.key.split("#")[0];
    if ((e.uses ?? []).length) sameSource.set(k, [...(sameSource.get(k) ?? []), e]);
  }
  const groups = duplicateGroups(reg);
  lines.push(`Same file on more than one page: ${multiUse.length}`);
  for (const e of multiUse) lines.push(`  - ${e.cloudinary?.publicId ?? e.key}: ${e.uses.map((u) => `${u.type}/${u.slug}`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`);
  const srcDup = [...sameSource.values()].filter((g) => g.length > 1);
  lines.push(`Same source uploaded more than once: ${srcDup.length}`);
  for (const g of srcDup) lines.push(`  - ${g[0].key.split("#")[0]}: ${g.map((e) => e.cloudinary?.publicId).join(" | ")}`);
  lines.push(`Near-duplicate groups (pHash ≤ ${PHASH_MAX_DISTANCE}, different files): ${groups.length}`);
  for (const g of groups) lines.push(`  - ${g.map((e) => `${e.cloudinary?.publicId ?? e.key}${e.distance != null ? ` (d=${e.distance})` : ""} [${(e.uses ?? []).map((u) => `${u.type}/${u.slug}`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}]`).join("  ≈  ")}`);
  return { multiUse, srcDup, groups, text: lines.join("\n") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reg = reportOnly ? loadRegistry() : await seedRegistry();
  if (!reportOnly) saveRegistry(reg);
  console.log(`[images] registry: ${reg.images.length} entries (${reg.images.filter((e) => e.uses?.length).length} in use).`);
  console.log(duplicateReport(reg).text);
}
