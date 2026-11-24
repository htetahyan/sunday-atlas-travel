#!/usr/bin/env node
/**
 * Tell IndexNow (Bing, Yandex, Seznam, Naver and the other engines that share it) which URLs changed.
 * Free, no account: ownership is proven by the key file public/<key>.txt served at the site root.
 *
 * URLs come from out/sitemap.xml:
 *   - default: every <loc> whose <lastmod> is within the last INDEXNOW_DAYS days (default 3);
 *   - INDEXNOW_ALL=1: every <loc> in the sitemap.
 * Before posting, the live key file is fetched (with retries, the deploy can take a minute to go live).
 * Prints the HTTP status; 200 or 202 means accepted. Never fails the deploy (exit 0 with a warning).
 *
 * Usage: node scripts/indexnow-ping.mjs [--dry-run]
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://sundayatlastravel.com").replace(/\/+$/, "");
const host = new URL(siteUrl).host;
const all = process.env.INDEXNOW_ALL === "1";
const days = Number(process.env.INDEXNOW_DAYS || 3);

function warn(message) {
  console.log(`::warning::IndexNow: ${message}`);
}

const keyFile = readdirSync(join(root, "public")).find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) {
  warn("no public/<32-hex>.txt key file; skipped.");
  process.exit(0);
}
const key = readFileSync(join(root, "public", keyFile), "utf8").trim();
const keyLocation = `${siteUrl}/${keyFile}`;

const sitemapPath = join(root, "out", "sitemap.xml");
if (!existsSync(sitemapPath)) {
  warn("out/sitemap.xml is missing; run the build first.");
  process.exit(0);
}
const xml = readFileSync(sitemapPath, "utf8");
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const urls = [];
for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
  const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
  if (!loc || new URL(loc).host !== host) continue;
  const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
  if (all || (lastmod && Date.parse(lastmod) >= cutoff)) urls.push(loc);
}
const urlList = [...new Set(urls)].slice(0, 10000);
console.log(`IndexNow: ${urlList.length} URL(s) ${all ? "(full sitemap)" : `changed in the last ${days} day(s)`}.`);
if (urlList.length === 0) process.exit(0);
if (dryRun) {
  console.log(urlList.slice(0, 20).join("\n"));
  process.exit(0);
}

async function keyIsLive() {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(`${keyLocation}?v=${Date.now()}`, { cache: "no-store" });
      if (res.ok && (await res.text()).trim() === key) return true;
      console.log(`IndexNow: key file not live yet (HTTP ${res.status}), attempt ${attempt}/6.`);
    } catch (error) {
      console.log(`IndexNow: key file fetch failed (${error.message}), attempt ${attempt}/6.`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  return false;
}

if (!(await keyIsLive())) {
  warn(`key file is not reachable at ${siteUrl}/<key>.txt; ping skipped.`);
  process.exit(0);
}

// A brand-new key answers 403 SiteVerificationNotCompleted until IndexNow has fetched the key file;
// retry a few times before giving up.
const attempts = Number(process.env.INDEXNOW_ATTEMPTS || 6);
for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
    });
    const body = (await res.text()).slice(0, 300);
    console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URL(s).${body ? ` ${body}` : ""}`);
    if (res.status === 200 || res.status === 202) process.exit(0);
    if (res.status !== 403 && res.status !== 429) break;
  } catch (error) {
    console.log(`IndexNow: request failed (${error.message}).`);
  }
  if (attempt < attempts) {
    console.log(`IndexNow: retrying in 60 s (attempt ${attempt}/${attempts}).`);
    await new Promise((r) => setTimeout(r, 60000));
  }
}
warn("ping was not accepted (see the HTTP status above).");
