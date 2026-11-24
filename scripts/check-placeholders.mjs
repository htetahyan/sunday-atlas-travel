#!/usr/bin/env node
// Fails the build if any exported HTML page shows a raw i18n placeholder
// such as "{remaining}" or leftover ICU syntax such as "{count, plural, ...}".
// Scans visible text plus user-facing attributes (alt, title, aria-label,
// placeholder, meta description/og/twitter content) and <title>.
// Usage: node scripts/check-placeholders.mjs [dir=out]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] || "out";
const PATTERNS = [
  { name: "placeholder", re: /\{[a-zA-Z_]+\}/g },
  { name: "ICU", re: /\{\s*[a-zA-Z_]+\s*,\s*(?:plural|select|selectordinal|number|date|time)\b[^}]*/g },
  { name: "ICU-branch", re: /\b(?:one|other|few|many|zero|two|=\d+)\s*\{[^{}]*#[^{}]*\}/g },
  { name: "mustache", re: /\{\{\s*[a-zA-Z_.]+\s*\}\}/g },
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (name.endsWith(".html")) files.push(p);
  }
  return files;
}

const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

export function visibleChunks(html) {
  const chunks = [];
  const attrRe = /\s(?:alt|title|aria-label|aria-description|placeholder|value)="([^"]*)"/gi;
  const metaRe = /<meta\b[^>]*\b(?:name|property)="(?:description|og:[a-z:_]+|twitter:[a-z:_]+)"[^>]*\bcontent="([^"]*)"[^>]*>/gi;
  const metaRe2 = /<meta\b[^>]*\bcontent="([^"]*)"[^>]*\b(?:name|property)="(?:description|og:[a-z:_]+|twitter:[a-z:_]+)"[^>]*>/gi;
  for (const re of [metaRe, metaRe2]) for (const m of html.matchAll(re)) chunks.push(["meta", decode(m[1])]);
  // Drop non-visible blocks (scripts carry the RSC payload with raw templates).
  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  for (const m of body.matchAll(/<[^>]+>/g)) {
    if (/^<meta\b/i.test(m[0])) continue;
    for (const a of m[0].matchAll(attrRe)) chunks.push(["attr", decode(a[1])]);
  }
  chunks.push(["text", decode(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ")]);
  return chunks;
}

export function findLeaks(html) {
  const hits = [];
  for (const [where, text] of visibleChunks(html)) {
    for (const { name, re } of PATTERNS) {
      for (const m of text.matchAll(re)) {
        const i = m.index ?? 0;
        hits.push({ where, name, match: m[0], context: text.slice(Math.max(0, i - 40), i + m[0].length + 40).trim() });
      }
    }
  }
  return hits;
}

/**
 * zh is a partial locale: a /zh/ page exists only when its copy is in Chinese. Every /zh/ page needs
 * Chinese in its <title> and <h1> (no English fallback shipped under /zh/), and every link to a
 * /zh/ URL, from any page, must point at a page that was built.
 */
const HAN_RE = /\p{Script=Han}/u;
export function partialLocaleProblems(dir, files) {
  const problems = [];
  const exists = (urlPath) => {
    const clean = urlPath.split(/[?#]/)[0];
    const target = clean.endsWith("/") ? join(dir, clean, "index.html") : join(dir, clean);
    try {
      return statSync(target).isFile() || statSync(join(target, "index.html")).isFile();
    } catch {
      try { return statSync(join(dir, clean, "index.html")).isFile(); } catch { return false; }
    }
  };
  const seen = new Map();
  for (const f of files) {
    const rel = relative(dir, f).split("\\").join("/");
    const html = readFileSync(f, "utf8");
    if (rel.startsWith("zh/")) {
      const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
      const title = decode(body.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const h1 = decode((body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, ""));
      if (title && !HAN_RE.test(title)) problems.push(`${rel} [zh/title] no Chinese: ${title.slice(0, 80)}`);
      if (h1 && !HAN_RE.test(h1)) problems.push(`${rel} [zh/h1] no Chinese: ${h1.slice(0, 80)}`);
    }
    for (const m of html.matchAll(/\shref="(\/zh\/[^"]*)"/g)) {
      const url = decode(m[1]);
      if (!seen.has(url)) seen.set(url, exists(url));
      if (!seen.get(url)) problems.push(`${rel} [zh/link] links to missing ${url}`);
    }
  }
  return problems;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  let files;
  try { files = walk(root); } catch { console.error(`check-placeholders: ${root}/ not found`); process.exit(1); }
  const problems = [];
  for (const f of files) {
    for (const h of findLeaks(readFileSync(f, "utf8"))) problems.push(`${relative(root, f)} [${h.where}/${h.name}] ${h.match}  …${h.context}…`);
  }
  problems.push(...partialLocaleProblems(root, files));
  console.log(`check-placeholders: scanned ${files.length} HTML file(s) in ${root}/`);
  if (problems.length) {
    console.error(`${problems.length} raw placeholder(s) in visible output:`);
    for (const p of problems.slice(0, 200)) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log("No raw {placeholders} or ICU leftovers found.");
}
