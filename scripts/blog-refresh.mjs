#!/usr/bin/env node
/**
 * Honest freshness for blog posts.
 *
 * Re-reads the live package catalog (content/packages, synced from Sanity) and
 * fixes every price and duration a post quotes for one of our tours. A post's
 * `updatedAt` moves only when its visible content actually changed: either this
 * script changed a fact, or someone edited the post (e.g. in Sanity) without the
 * stored contentHash being updated. Posts without a contentHash get a baseline
 * hash and keep their date.
 *
 * Usage: node scripts/blog-refresh.mjs [--dry-run] [--slug=<slug>]
 * Writes the slugs it changed to .blog-changed.json (consumed by sanity-push-blog.mjs).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  findPrices,
  finalizeDates,
  formatLike,
  isLivePackage,
  isLinkablePackage,
  loadCatalog,
  loadPosts,
  nowIso,
  readJson,
  walkStrings,
  getAt,
  setAt,
  writeJson,
} from "./lib/blog-core.mjs";

const CHANGED_FILE = join(ROOT, ".blog-changed.json");
const GENERIC = new Set(
  "day days trip tour tours from private the and a an in of to with by on 4wd high speed private afternoon night".split(" "),
);

function aliasesFor(pkg) {
  const out = [];
  const words = `${pkg.slug.replace(/-/g, " ")} ${pkg.title?.en ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !GENERIC.has(w) && !/^\d+$/.test(w));
  for (const w of new Set(words)) out.push({ re: new RegExp(`\\b${w}\\b`, "i"), weight: 1 });
  const n = pkg.durationDays;
  if (typeof n === "number" && n > 1) {
    out.push({ re: new RegExp(`\\b${n}[- ]day`, "i"), weight: 2 });
  }
  return out;
}

function score(pkg, context) {
  return pkg._aliases.reduce((sum, a) => sum + (a.re.test(context) ? a.weight : 0), 0);
}

/** Pick the tour a price mention refers to, or null when unsure. */
function matchPackage({ context, candidates, live, embedded }) {
  const scored = live
    .map((pkg) => ({ pkg, s: score(pkg, context) + (candidates.has(pkg.slug) ? 0.5 : 0) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s);
  if (scored.length > 0 && (scored.length === 1 || scored[0].s > scored[1].s)) return scored[0].pkg;
  if (embedded) return embedded;
  return null;
}

function isStartingPrice(textBefore) {
  return /(from|starts?|starting|priced at|costs?)\s*\$?\s*$/i.test(textBefore.slice(-22)) || /\(\s*$/.test(textBefore);
}

export function refreshPost(original, catalog) {
  const post = structuredClone(original);
  const changes = [];
  const warnings = [];
  const live = [...catalog.packages.values()].filter(isLivePackage);
  for (const pkg of live) pkg._aliases ??= aliasesFor(pkg);
  const candidates = new Set([
    ...(post.relatedPackages ?? []),
    ...(post.sections ?? []).map((s) => s.embeddedPackageSlug).filter(Boolean),
  ]);
  const candidatePkgs = live.filter((p) => candidates.has(p.slug));
  const minCandidate = candidatePkgs.length ? Math.min(...candidatePkgs.map((p) => p.priceFrom)) : null;

  // 1. Collect English fields with price mentions.
  const fields = [];
  walkStrings(post, (text, path) => {
    if (path[path.length - 1] !== "en" && path[path.length - 2] !== "en") return;
    if (findPrices(text).length) fields.push({ path, text });
  });

  for (const { path, text } of fields) {
    const enIdx = path.lastIndexOf("en");
    const base = path.slice(0, enIdx);
    const tail = path.slice(enIdx + 1);
    const sectionIdx = path[0] === "sections" ? path[1] : null;
    const section = sectionIdx != null ? post.sections[sectionIdx] : null;
    const embedded = section?.embeddedPackageSlug ? catalog.packages.get(section.embeddedPackageSlug) : null;
    const isKeyFact = path.includes("keyFacts");
    const label = isKeyFact ? getAt(post, [...path.slice(0, path.indexOf("keyFacts") + 2), "label", "en"]) ?? "" : "";

    const mentions = findPrices(text);
    const replacements = []; // { i, old, next }
    let prevEnd = 0;
    mentions.forEach((m, i) => {
      const before = text.slice(prevEnd, m.index);
      const sentenceStart = Math.max(before.lastIndexOf(". "), before.lastIndexOf("; "));
      const context = `${label} ${sentenceStart >= 0 ? before.slice(sentenceStart) : before}`;
      prevEnd = m.index + m.length;
      const isPostLevel = ["summary", "seo", "intro", "subtitle"].includes(String(path[0]));
      if (isPostLevel && /from\s*\$?\s*$/i.test(text.slice(0, m.index).slice(-12))) {
        // "tours from $X" on the post as a whole: must be the cheapest linked tour or a real price.
        if (candidatePkgs.some((p) => p.validPrices.has(m.value)) || minCandidate == null) return;
        replacements.push({ i, old: m.value, next: minCandidate });
        return;
      }
      let pkg = matchPackage({ context, candidates, live, embedded: isKeyFact || i === 0 ? embedded && isLivePackage(embedded) ? embedded : null : null });
      if (pkg && pkg.validPrices.has(m.value)) return; // already a real price of that tour
      if (!pkg) {
        const anyCandidateHas = candidatePkgs.some((p) => p.validPrices.has(m.value));
        if (anyCandidateHas) return;
        warnings.push(`${post.slug}: unverified price ${m.numText} at ${path.join(".")}`);
        return;
      }
      if (!isKeyFact && !isStartingPrice(text.slice(0, m.index))) {
        warnings.push(`${post.slug}: ${m.numText} at ${path.join(".")} looks like ${pkg.slug} but is not a starting price; left as is`);
        return;
      }
      replacements.push({ i, old: m.value, next: pkg.priceFrom, slug: pkg.slug });
    });
    if (replacements.length === 0) continue;

    // 2. Apply to every locale of this field.
    const localized = getAt(post, base);
    for (const locale of Object.keys(localized || {})) {
      const value = getAt(post, [...base, locale, ...tail]);
      if (typeof value !== "string") continue;
      const found = findPrices(value);
      let out = value;
      // Replace from the end so indexes stay valid.
      const byIndex = found.length === mentions.length;
      for (let j = found.length - 1; j >= 0; j -= 1) {
        const f = found[j];
        const rep = byIndex ? replacements.find((r) => r.i === j && r.old === f.value) : replacements.find((r) => r.old === f.value);
        if (!rep) continue;
        out = out.slice(0, f.numIndex) + formatLike(f.numText, rep.next) + out.slice(f.numIndex + f.numText.length);
      }
      if (out !== value) {
        setAt(post, [...base, locale, ...tail], out);
        if (locale === "en") {
          for (const r of replacements) changes.push(`${path.join(".")}: ${r.old} -> ${r.next}${r.slug ? ` (${r.slug})` : ""}`);
        }
      }
    }
  }

  // 3. Duration rows in sections that embed a tour.
  for (const [si, sec] of (post.sections ?? []).entries()) {
    const pkg = sec.embeddedPackageSlug ? catalog.packages.get(sec.embeddedPackageSlug) : null;
    if (!isLivePackage(pkg)) continue;
    for (const row of sec.keyFacts ?? []) {
      if (!/^(duration|length)$/i.test(row.label?.en ?? "")) continue;
      for (const locale of Object.keys(row.value ?? {})) {
        const v = row.value[locale];
        if (typeof v !== "string") continue;
        // "5 Days / 4 Nights", "5 Tage / 4 Nächte", "5日間 / 4泊": swap the numbers, keep the words.
        const m = v.match(/^(\d+)([^/\d]*)(?:\/\s*(\d+)(.*))?$/);
        if (!m) continue;
        let next = v;
        if (Number(m[1]) !== pkg.durationDays) {
          next = next.replace(/^\d+/, String(pkg.durationDays));
          if (locale === "en") next = next.replace(/^(\d+)\s*Days?\b/i, (_, d) => `${d} ${d === "1" ? "Day" : "Days"}`);
        }
        if (m[3] && typeof pkg.nights === "number" && Number(m[3]) !== pkg.nights) {
          next = next.replace(/\/\s*\d+/, `/ ${pkg.nights}`);
          if (locale === "en") next = next.replace(/\/ (\d+)\s*Nights?\b/i, (_, n) => `/ ${n} ${n === "1" ? "Night" : "Nights"}`);
        }
        if (next !== v) {
          row.value[locale] = next;
          if (locale === "en") changes.push(`sections.${si} duration: "${v}" -> "${next}" (${pkg.slug})`);
        }
      }
    }
  }

  // 4. Drop links to tours that are no longer live.
  const relatedBefore = post.relatedPackages ?? [];
  // Price-on-request tours stay linked (they have no price to refresh).
  post.relatedPackages = relatedBefore.filter((slug) => isLinkablePackage(catalog.packages.get(slug)));
  if (post.relatedPackages.length !== relatedBefore.length) {
    changes.push(`relatedPackages: removed ${relatedBefore.filter((s) => !post.relatedPackages.includes(s)).join(", ")}`);
  }
  return { post, changes, warnings };
}

export function recordChanged(slugs) {
  const prev = existsSync(CHANGED_FILE) ? readJson(CHANGED_FILE) : [];
  writeJson(CHANGED_FILE, Array.from(new Set([...prev, ...slugs])).sort());
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = args.find((a) => a.startsWith("--slug="))?.slice(7);
  const catalog = loadCatalog();
  const now = nowIso();
  const changed = [];
  let baselined = 0;
  for (const { file, post } of loadPosts()) {
    if (only && post.slug !== only) continue;
    const { post: next, changes, warnings } = refreshPost(post, catalog);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
    const hadHash = typeof post.contentHash === "string";
    const bumped = finalizeDates(post, next, {
      now,
      reason: changes.length ? `catalog refresh: ${changes.length} fact(s)` : "content edited outside the pipeline",
    });
    if (bumped) {
      changed.push(post.slug);
      console.log(`✓ ${post.slug}: updated (${changes.length} catalog fact(s))`);
      for (const c of changes) console.log(`    - ${c}`);
    } else if (!hadHash) {
      baselined += 1;
    }
    if (!dryRun && JSON.stringify(next) !== JSON.stringify(post)) writeJson(file, next);
  }
  console.log(`[blog:refresh] ${changed.length} post(s) changed, ${baselined} baselined without a date change${dryRun ? " (dry run, nothing written)" : ""}.`);
  if (!dryRun && changed.length) recordChanged(changed);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("❌ [blog:refresh]", err.stack || err);
    process.exit(1);
  });
}
