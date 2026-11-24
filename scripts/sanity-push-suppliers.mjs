#!/usr/bin/env node
// Push the optional private suppliers file into PRIVATE Sanity docs `suppliers.<package-slug>`
// (type packageSupplier). Dotted _ids are never returned to unauthenticated readers, so this
// is safe on the public `production` dataset. Never put supplier fields on travelPackage docs.
// Token: SANITY_API_WRITE_TOKEN | SANITY_API_TOKEN env, or SANITY_TOKEN_FILE (path). Never printed.
// Usage: node scripts/sanity-push-suppliers.mjs [--dry-run]
import { readFileSync, existsSync } from "node:fs";
import { catalogWithSuppliers, loadSuppliers, SUPPLIERS_PATH } from "./lib/suppliers.mjs";

if (!existsSync(SUPPLIERS_PATH)) {
  console.log("No private suppliers file; nothing to push.");
  process.exit(0);
}

const PROJECT = process.env.SANITY_PROJECT_ID || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "mi09tcmc";
const DATASET = process.env.SANITY_DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const API = "v2024-01-01";
const dry = process.argv.includes("--dry-run");

function token() {
  const t = process.env.SANITY_API_WRITE_TOKEN || process.env.SANITY_API_TOKEN;
  if (t) return t.trim();
  const f = process.env.SANITY_TOKEN_FILE;
  if (f && existsSync(f)) return readFileSync(f, "utf8").trim();
  return "";
}

const data = loadSuppliers();
const { packages } = catalogWithSuppliers({ includeUnpublished: true });
const now = new Date().toISOString();
const docs = packages
  .filter((p) => p.supplier.recorded)
  .map((p) => ({
    _id: `suppliers.${p.slug}`,
    _type: "packageSupplier",
    packageSlug: p.slug,
    supplierKey: p.supplier.key ?? "",
    name: p.supplier.name,
    contact: p.supplier.contact,
    source: p.supplier.source,
    priceRule: p.supplier.priceRule,
    evidence: p.supplier.evidence,
    syncedAt: now,
  }));
const slugs = new Set(docs.map((d) => d.packageSlug));
for (const slug of Object.keys(data.packages || {})) {
  if (!slugs.has(slug)) console.warn(`! suppliers.json has a record for "${slug}" but no content/packages file matches it`);
}

const tk = token();
if (!tk) {
  console.error("✗ No Sanity write token (set SANITY_API_WRITE_TOKEN or SANITY_TOKEN_FILE).");
  process.exit(2);
}
const url = `https://${PROJECT}.api.sanity.io/${API}/data/mutate/${DATASET}?returnIds=true${dry ? "&dryRun=true" : ""}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${tk}` },
  body: JSON.stringify({ mutations: docs.map((d) => ({ createOrReplace: d })) }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`✗ Sanity mutate failed: HTTP ${res.status} ${body?.error?.description || body?.message || ""}`);
  process.exit(1);
}
console.log(`✓ ${dry ? "[dry-run] " : ""}${docs.length} private supplier docs written to ${PROJECT}/${DATASET} (ids suppliers.<slug>).`);

// Privacy proof: the same query without a token must return nothing.
const q = encodeURIComponent('count(*[_type == "packageSupplier" || _id in path("suppliers.**")])');
const pub = await fetch(`https://${PROJECT}.api.sanity.io/${API}/data/query/${DATASET}?query=${q}`).then((r) => r.json());
if (pub.result !== 0) {
  console.error(`✗ PRIVACY: unauthenticated query sees ${pub.result} supplier docs!`);
  process.exit(1);
}
console.log("✓ Unauthenticated query sees 0 supplier docs (private).");
