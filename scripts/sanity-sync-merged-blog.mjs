#!/usr/bin/env node
/**
 * Keep the Sanity copies of merged blog posts (content/blog-merged.json) in step with the repo:
 * the old post is unpublished (published: false, mergedInto) and the post it was merged into
 * carries the merged FAQs and links. Only documents whose Sanity copy is behind are pushed, so
 * running this on every deploy is a no-op once Sanity matches.
 *
 *   node scripts/sanity-sync-merged-blog.mjs [--dry-run]
 *
 * Reads Sanity through the public API. Pushing needs SANITY_API_WRITE_TOKEN; without it the
 * script warns and exits 0 (the build's Sanity sync keeps the newer local posts and forces merged
 * posts to stay unpublished, so the site is right either way).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BLOG_DIR, CONTENT_DIR, dateValue, readJson } from "./lib/blog-core.mjs";
import { toSanityBlogPost } from "./lib/sanity-blog.mjs";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "mi09tcmc";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN || "";
const DRY = process.argv.includes("--dry-run");

function mergedList() {
  const file = join(CONTENT_DIR, "blog-merged.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")).merged ?? [];
}

async function sanityState(slugs) {
  const groq = `*[_type == "blogPost" && slug in $slugs]{slug, published, updatedAt, mergedInto}`;
  const url = new URL(`https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}`);
  url.searchParams.set("query", groq);
  url.searchParams.set("$slugs", JSON.stringify(slugs));
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Sanity query HTTP ${res.status}`);
  const json = await res.json();
  return new Map((json.result ?? []).map((d) => [d.slug, d]));
}

async function main() {
  const merged = mergedList();
  if (merged.length === 0) {
    console.log("[blog:merged] no merged posts.");
    return;
  }
  const slugs = [...new Set(merged.flatMap((m) => [m.from, m.to]))].filter((s) =>
    existsSync(join(BLOG_DIR, `${s}.json`)),
  );
  const remote = await sanityState(slugs);
  const stale = slugs.filter((slug) => {
    const local = readJson(join(BLOG_DIR, `${slug}.json`));
    const r = remote.get(slug);
    if (!r) return true;
    if (Boolean(r.published) !== Boolean(local.published)) return true;
    if ((r.mergedInto || "") !== (local.mergedInto || "")) return true;
    return dateValue(local.updatedAt) > dateValue(r.updatedAt);
  });
  if (stale.length === 0) {
    console.log(`✓ [blog:merged] Sanity already matches ${slugs.length} merged/target post(s).`);
    return;
  }
  if (DRY) {
    console.log(`[blog:merged] dry run: would push ${stale.join(", ")}`);
    return;
  }
  if (!token) {
    console.log(`::warning::SANITY_API_WRITE_TOKEN is not set; merged blog posts not pushed to Sanity: ${stale.join(", ")}`);
    return;
  }
  const docs = stale.map((slug) => toSanityBlogPost({ id: slug, data: readJson(join(BLOG_DIR, `${slug}.json`)) }));
  const res = await fetch(`https://${projectId}.api.sanity.io/v2024-01-01/data/mutate/${dataset}?returnIds=true`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ mutations: docs.map((doc) => ({ createOrReplace: doc })) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sanity mutate HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  console.log(`✓ [blog:merged] pushed ${docs.length} post(s) to Sanity: ${stale.join(", ")}`);
}

main().catch((err) => {
  console.error("❌ [blog:merged]", err.message || err);
  process.exit(1);
});
