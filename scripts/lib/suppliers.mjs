// Optional private supplier records. Set SUPPLIERS_FILE, or place the file at
// content/private/suppliers.json (that directory is gitignored). Nothing under
// src/ or app/ may import this file.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPLIER_RE } from "./blog-core.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SUPPLIERS_PATH = process.env.SUPPLIERS_FILE || join(ROOT, "content", "private", "suppliers.json");
export const UNKNOWN = "Unknown – check";
export const SITE = "https://sundayatlastravel.com";

export function loadSuppliers() {
  if (!existsSync(SUPPLIERS_PATH)) {
    return { suppliers: {}, packages: {}, extraBannedNames: [] };
  }
  return JSON.parse(readFileSync(SUPPLIERS_PATH, "utf8"));
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s._-]*");

/** Names and aliases from the optional private file, plus SUPPLIER_RE. */
export function supplierNameRegex(data = loadSuppliers()) {
  const terms = new Set();
  for (const s of Object.values(data.suppliers || {})) {
    for (const a of s.aliases || []) terms.add(String(a).toLowerCase());
  }
  for (const n of data.extraBannedNames || []) terms.add(String(n).toLowerCase());
  const own = [...terms].filter(Boolean).sort((a, b) => b.length - a.length).map(esc).filter(Boolean).join("|");
  const body = own ? `${own}|${SUPPLIER_RE.source}` : SUPPLIER_RE.source;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}])`, "giu");
}

function readFolder(folder) {
  const dir = join(ROOT, "content", folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

const en = (v) => (v && typeof v === "object" ? v.en ?? "" : v ?? "");

/** Published packages and destinations joined with their private supplier records, when a file is present. */
export function catalogWithSuppliers({ includeUnpublished = false, sanityRecords = null } = {}) {
  const data = loadSuppliers();
  const pkgs = readFolder("packages").filter((p) => includeUnpublished || p.published);
  const dests = readFolder("destinations").filter((d) => includeUnpublished || d.published);
  const packages = pkgs.map((p) => {
    const rec = data.packages?.[p.slug] || null;
    const sup = rec?.supplier ? data.suppliers[rec.supplier] : null;
    const sanity = sanityRecords ? sanityRecords[p.slug] || null : undefined;
    return {
      slug: p.slug,
      name: en(p.title),
      url: `${SITE}/en/packages/${p.slug}/`,
      destination: p.destination,
      countries: [...new Set([p.destination, ...(p.countries || [])].filter(Boolean))],
      durationDays: p.durationDays ?? null,
      nights: p.nights ?? null,
      priceFromUsd: typeof p.priceFrom === "number" ? p.priceFrom : null,
      published: Boolean(p.published),
      supplier: {
        key: rec?.supplier ?? null,
        name: sup ? (rec?.supplierLabel ? `${rec.supplierLabel}: ${sup.name}` : sup.name) : rec?.supplierLabel || UNKNOWN,
        likely: rec?.likelySupplier ? data.suppliers[rec.likelySupplier]?.name ?? rec.likelySupplier : null,
        contact: sup?.contact ?? (rec?.likelySupplier ? data.suppliers[rec.likelySupplier]?.contact ?? "" : ""),
        source: rec?.source ?? "",
        priceRule: rec?.priceRule ?? "",
        evidence: rec?.evidence ?? (rec ? "" : "No private supplier record"),
        recorded: Boolean(rec),
      },
      ...(sanity !== undefined ? { sanitySupplier: sanity } : {}),
    };
  });
  const destinations = dests.map((d) => {
    const here = packages.filter((p) => p.countries.includes(d.slug));
    return {
      slug: d.slug,
      name: en(d.name) || d.slug,
      url: `${SITE}/en/destinations/${d.slug}/`,
      packageCount: here.length,
      suppliers: [...new Set(here.map((p) => p.supplier.name))].sort(),
      packages: here.map((p) => p.slug),
    };
  });
  return { generatedAt: new Date().toISOString(), packages, destinations };
}
