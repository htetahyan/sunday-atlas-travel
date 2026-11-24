#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRANSLATE_MODEL,
  FALLBACK_TRANSLATE_MODEL,
  BRAND_RE,
} from "./lib/auto-translate-core.mjs";

export const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const blogDir = join(rootDir, "content", "blog");

async function main() {
  mkdirSync(blogDir, { recursive: true });
  const files = readdirSync(blogDir).filter((f) => f.endsWith(".json")).sort();
  console.log(`✓ [blog:ai] Configured Cloudflare Workers AI models:`);
  console.log(`  • Text & 5-Locale Translation: ${TRANSLATE_MODEL} (fallback: ${FALLBACK_TRANSLATE_MODEL})`);
  console.log(`  • AI Image Generation Fallback: ${IMAGE_MODEL}`);
  console.log(`  • Active blog guides in content/blog/: ${files.length}`);
  for (const f of files) {
    const raw = readFileSync(join(blogDir, f), "utf8");
    const data = JSON.parse(raw);
    if (BRAND_RE.test(raw)) {
      throw new Error(`Brand compliance failure in ${f}`);
    }
    console.log(`    - ${data.slug} [${data.category}] (${data.destination}) -> ${(data.sections || []).length} sections, ${(data.relatedPackages || []).length} linked tours`);
  }
}

main().catch((err) => {
  console.error("❌ [blog:ai]", err.message || err);
  process.exit(1);
});
