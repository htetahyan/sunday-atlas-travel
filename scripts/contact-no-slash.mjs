import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Cloudflare Pages 308-redirects /<locale>/contact to /<locale>/contact/ when
 * only contact/index.html exists. Writing a sibling contact.html lets
 * /<locale>/contact?package=<slug> be served directly (200) with no slash.
 */
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
if (existsSync(out)) {
  for (const entry of readdirSync(out, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = join(out, entry.name, "contact", "index.html");
    if (existsSync(src)) copyFileSync(src, join(out, entry.name, "contact.html"));
  }
}
