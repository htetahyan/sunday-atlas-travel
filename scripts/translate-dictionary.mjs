#!/usr/bin/env node
/**
 * Fill missing UI strings in src/i18n/dictionaries/<locale>.json from en.json with the blog AI
 * client (NVIDIA first, Workers AI fallback). Only zh is supported for now; existing strings are
 * kept, so a person's edit is never overwritten. Run after adding keys to en.json:
 *   NVIDIA_API_KEY=... node scripts/translate-dictionary.mjs --locale=zh [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { translateStrings } from "./lib/zh-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, d) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? d;
const locale = arg("locale", "zh");
const dry = process.argv.includes("--dry-run");
if (locale !== "zh") {
  console.error("Only --locale=zh is supported.");
  process.exit(2);
}
const dir = join(root, "src", "i18n", "dictionaries");
const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));
const file = join(dir, `${locale}.json`);
const target = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

// Keys whose value must not be machine translated (language names, status markers).
const KEEP = new Set(["_status", "languages"]);
const leaves = [];
function walk(src, dst, path) {
  for (const [k, v] of Object.entries(src)) {
    const p = path ? `${path}.${k}` : k;
    if (!path && KEEP.has(k)) continue;
    if (typeof v === "string") {
      if (!(dst && typeof dst[k] === "string" && dst[k].trim())) leaves.push({ id: p, text: v });
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const ip = `${p}[${i}]`;
        const d = Array.isArray(dst?.[k]) ? dst[k][i] : undefined;
        if (typeof item === "string") {
          if (!(typeof d === "string" && d.trim())) leaves.push({ id: ip, text: item });
        } else if (item && typeof item === "object") walk(item, d, ip);
      });
    } else if (v && typeof v === "object") walk(v, dst?.[k], p);
  }
}
walk(en, target, "");
console.log(`[dict:${locale}] ${leaves.length} missing string(s)`);
if (dry || leaves.length === 0) process.exit(0);

const { done, failed, models } = await translateStrings(leaves, {
  context: "User-interface strings, legal pages (terms, privacy) and FAQ of a travel company website. Translate legal text faithfully and completely.",
});

function setPath(obj, path, value, template) {
  const parts = path.match(/[^.[\]]+|\[\d+\]/g).map((p) => (p.startsWith("[") ? Number(p.slice(1, -1)) : p));
  let o = obj;
  let t = template;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    t = t?.[key];
    if (o[key] === undefined || o[key] === null) o[key] = Array.isArray(t) ? [] : {};
    o = o[key];
  }
  o[parts[parts.length - 1]] = value;
}
for (const [id, value] of done) setPath(target, id, value, en);

// Same key order as en.json.
function order(src, dst) {
  if (Array.isArray(src)) return Array.isArray(dst) ? src.map((s, i) => order(s, dst[i])) : dst;
  if (src && typeof src === "object" && dst && typeof dst === "object") {
    const out = {};
    for (const k of Object.keys(src)) if (k in dst) out[k] = order(src[k], dst[k]);
    for (const k of Object.keys(dst)) if (!(k in out)) out[k] = dst[k];
    return out;
  }
  return dst;
}
writeFileSync(file, JSON.stringify(order(en, target), null, 2) + "\n");
console.log(`[dict:${locale}] wrote ${done.size}, failed ${failed.length} (models: ${models.join(", ")})`);
if (failed.length) process.exitCode = 3;
