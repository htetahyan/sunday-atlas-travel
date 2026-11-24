#!/usr/bin/env node
/**
 * Push changed blog posts to Sanity (createOrReplace) so the CMS matches the repo.
 *
 *   node scripts/sanity-push-blog.mjs                 # slugs listed in .blog-changed.json
 *   node scripts/sanity-push-blog.mjs --slugs=a,b     # explicit slugs
 *   node scripts/sanity-push-blog.mjs --all           # every content/blog/*.json
 *   add --dry-run to print what would be sent.
 *
 * Needs SANITY_API_WRITE_TOKEN (Editor token). Without it the script warns and exits 0, because
 * the build's Sanity sync keeps newer local posts (see scripts/sync-from-sanity.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BLOG_DIR, ROOT, listBlogFiles, readJson } from "./lib/blog-core.mjs";
import { toSanityBlogPost } from "./lib/sanity-blog.mjs";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "mi09tcmc";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN || process.env.SANITY_API_TOKEN || "";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);

function slugsToPush() {
  if (args.all) return listBlogFiles().map((f) => f.replace(/\.json$/, "").split("/").pop());
  if (typeof args.slugs === "string") return args.slugs.split(",").map((s) => s.trim()).filter(Boolean);
  const file = join(ROOT, ".blog-changed.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")).slugs ?? [];
}

async function main() {
  const slugs = [...new Set(slugsToPush())];
  if (slugs.length === 0) {
    console.log("[blog:push] nothing to push.");
    return;
  }
  const docs = slugs
    .filter((slug) => existsSync(join(BLOG_DIR, `${slug}.json`)))
    .map((slug) => toSanityBlogPost({ id: slug, data: readJson(join(BLOG_DIR, `${slug}.json`)) }));
  if (args["dry-run"]) {
    console.log(`[blog:push] dry run: would createOrReplace ${docs.map((d) => d._id).join(", ")}`);
    return;
  }
  if (!token) {
    console.log(
      `::warning::SANITY_API_WRITE_TOKEN is not set, so ${docs.length} blog post(s) were committed to the repo but not pushed to Sanity: ${slugs.join(", ")}`,
    );
    return;
  }
  for (let i = 0; i < docs.length; i += 10) {
    const chunk = docs.slice(i, i + 10);
    const res = await fetch(`https://${projectId}.api.sanity.io/v2024-01-01/data/mutate/${dataset}?returnIds=true`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ mutations: chunk.map((doc) => ({ createOrReplace: doc })) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Sanity mutate HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
  }
  console.log(`✓ [blog:push] pushed ${docs.length} blog post(s) to Sanity ${projectId}/${dataset}: ${slugs.join(", ")}`);
}

main().catch((err) => {
  console.error("❌ [blog:push]", err.message || err);
  process.exit(1);
});
