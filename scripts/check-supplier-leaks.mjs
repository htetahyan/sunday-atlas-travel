#!/usr/bin/env node
// Fails the build if any known supplier / third-party operator name appears anywhere in the
// public build output (HTML, RSC payloads, JS, JSON-LD, /exports/*, chat index, sitemaps) or
// in the Pages Functions source that ships with it.
// Names come from the optional private suppliers file (names, aliases, extraBannedNames) plus
// SUPPLIER_RE from scripts/lib/blog-core.mjs (booking platforms and any extra fragments).
// Usage: node scripts/check-supplier-leaks.mjs [dir=out] [--also=functions]
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { supplierNameRegex, ROOT } from "./lib/suppliers.mjs";

const args = process.argv.slice(2);
const dirs = [args.find((a) => !a.startsWith("--")) || "out"];
const also = args.find((a) => a.startsWith("--also="));
if (also) dirs.push(...also.slice(7).split(",").filter(Boolean));
else dirs.push("functions");

const TEXT = new Set([".html", ".htm", ".txt", ".json", ".ndjson", ".csv", ".xml", ".js", ".mjs", ".ts", ".css", ".map", ".rsc", ".webmanifest", ".yml", ".yaml", ".md", ""]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (TEXT.has(extname(name).toLowerCase()) && st.size < 50 * 1024 * 1024) files.push(p);
  }
  return files;
}

const re = supplierNameRegex();
const hits = [];
let scanned = 0;
for (const d of dirs) {
  const abs = join(ROOT, d);
  if (!existsSync(abs)) {
    if (d === dirs[0]) {
      console.error(`✗ [supplier-leaks] ${d}/ not found – run the build first.`);
      process.exit(2);
    }
    continue;
  }
  for (const f of walk(abs)) {
    scanned++;
    const text = readFileSync(f, "utf8");
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      hits.push({ file: relative(ROOT, f), match: m[0], context: text.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, " ") });
      if (hits.length > 200) break;
    }
  }
}

if (hits.length) {
  console.error(`✗ [supplier-leaks] ${hits.length} supplier-name hit(s) in public output (${scanned} files scanned):`);
  for (const h of hits.slice(0, 50)) console.error(`  ${h.file}: "${h.match}" … ${h.context} …`);
  process.exit(1);
}
console.log(`✓ [supplier-leaks] 0 supplier names in ${dirs.join(", ")} (${scanned} files scanned).`);
