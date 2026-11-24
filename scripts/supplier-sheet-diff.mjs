#!/usr/bin/env node
// Prints published packages and destinations joined with optional private supplier records as JSON.
//   node scripts/supplier-sheet-diff.mjs                 # full JSON {packages, destinations, missing}
//   node scripts/supplier-sheet-diff.mjs --rows          # 2-D rows for both tabs
//   node scripts/supplier-sheet-diff.mjs --all           # include unpublished/sample content
//   node scripts/supplier-sheet-diff.mjs --sanity        # also read private Sanity suppliers.* docs
//                                                       #   (needs SANITY_API_READ_TOKEN / SANITY_TOKEN_FILE)
// Run `npm run sync:sanity` first if packages were added in Sanity Studio.
// Output contains private supplier fields – never write it into out/, public/ or content/<public folder>/.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { catalogWithSuppliers, ROOT, SUPPLIERS_PATH } from "./lib/suppliers.mjs";

if (!existsSync(SUPPLIERS_PATH)) {
  console.log("No private suppliers file; nothing to diff.");
  process.exit(0);
}

const args = new Set(process.argv.slice(2));

async function sanityRecords() {
  const tk = (process.env.SANITY_API_READ_TOKEN || process.env.SANITY_API_TOKEN || "").trim() ||
    (process.env.SANITY_TOKEN_FILE && existsSync(process.env.SANITY_TOKEN_FILE) ? readFileSync(process.env.SANITY_TOKEN_FILE, "utf8").trim() : "");
  if (!tk) throw new Error("--sanity needs SANITY_API_READ_TOKEN or SANITY_TOKEN_FILE");
  const project = process.env.SANITY_PROJECT_ID || "mi09tcmc";
  const dataset = process.env.SANITY_DATASET || "production";
  const q = encodeURIComponent('*[_type == "packageSupplier"]{packageSlug, name, contact, priceRule, syncedAt}');
  const r = await fetch(`https://${project}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${q}&perspective=raw`, {
    headers: { authorization: `Bearer ${tk}` },
  }).then((x) => x.json());
  return Object.fromEntries((r.result || []).map((d) => [d.packageSlug, d]));
}

function firstAdded(path) {
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--follow", "--format=%cI", "--", path], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    if (!out.length) return "";
    const d = new Date(out[out.length - 1]);
    return new Date(d.getTime() + 4 * 3600e3).toISOString().slice(0, 10); // Asia/Dubai (UTC+4)
  } catch {
    return "";
  }
}

const recs = args.has("--sanity") ? await sanityRecords() : null;
const data = catalogWithSuppliers({ includeUnpublished: args.has("--all"), sanityRecords: recs });
for (const p of data.packages) p.dateAdded = firstAdded(`content/packages/${p.slug}.json`);
for (const d of data.destinations) d.dateAdded = firstAdded(`content/destinations/${d.slug}.json`);
data.missing = data.packages.filter((p) => !p.supplier.recorded || p.supplier.key === null).map((p) => p.slug);

const syncedLabel = `${new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 16).replace("T", " ")} (Dubai, UTC+4)`;

if (args.has("--rows")) {
  const money = (n) => (n == null ? "" : n);
  const pkgHeader = ["Package name", "Package URL (live site, en)", "Destination / country", "Duration", "Our from-price (USD)", "Supplier", "Supplier contact / website / source doc", "Pricing note", "Evidence", "Date added to site", "Last synced"];
  const pkgRows = data.packages.map((p) => [
    p.name, p.url, p.countries.join(", "),
    p.durationDays ? `${p.durationDays} day${p.durationDays > 1 ? "s" : ""}${p.nights ? ` / ${p.nights} night${p.nights > 1 ? "s" : ""}` : ""}` : "",
    money(p.priceFromUsd), p.supplier.name,
    [p.supplier.contact, p.supplier.source].filter(Boolean).join(" | "),
    p.supplier.priceRule || "Unknown", p.supplier.evidence, p.dateAdded, syncedLabel,
  ]);
  const destHeader = ["Destination page", "URL (live site, en)", "Suppliers used there", "Package count", "Date added to site", "Last synced"];
  const destRows = data.destinations.map((d) => [d.name, d.url, d.suppliers.join("; ") || "—", d.packageCount, d.dateAdded, syncedLabel]);
  console.log(JSON.stringify({ Packages: [pkgHeader, ...pkgRows], Destinations: [destHeader, ...destRows], missing: data.missing }, null, 2));
} else {
  console.log(JSON.stringify(data, null, 2));
}
