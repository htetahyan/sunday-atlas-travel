import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Rewrites site_url and display_url in out/admin/config.yml from
 * NEXT_PUBLIC_SITE_URL. The source file public/admin/config.yml keeps its
 * documented default. This script never prints the URL or other env values.
 *
 * Resolution: process.env first. If that is unset, the first of these files
 * that defines the variable wins: .env.local, .env.production, .env.
 * That matches Next's production load order (dotenv does not override a
 * value an earlier file already set; .env.local is loaded before .env.production).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "out", "admin", "config.yml");
const envFiles = [".env.local", ".env.production", ".env"];

function valueFromEnvFile(filePath) {
  if (!existsSync(filePath)) return undefined;
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    console.warn("cms-site-url: could not read an env file; skipping it.");
    return undefined;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?NEXT_PUBLIC_SITE_URL\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return undefined;
}

function resolveSiteUrl() {
  const fromProcess = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromProcess) return fromProcess;
  for (const name of envFiles) {
    const value = valueFromEnvFile(join(root, name));
    if (value) return value;
  }
  return undefined;
}

const raw = resolveSiteUrl();
if (!raw) {
  console.warn(
    "cms-site-url: NEXT_PUBLIC_SITE_URL is unset; leaving out/admin/config.yml unchanged.",
  );
  process.exit(0);
}

const siteUrl = raw.replace(/\/+$/, "");
if (!siteUrl) {
  console.warn(
    "cms-site-url: NEXT_PUBLIC_SITE_URL is unset; leaving out/admin/config.yml unchanged.",
  );
  process.exit(0);
}

if (!existsSync(outFile)) {
  console.warn("cms-site-url: out/admin/config.yml is missing; nothing to rewrite.");
  process.exit(0);
}

const yaml = readFileSync(outFile, "utf8");

function replaceLine(source, key) {
  const pattern = new RegExp(`^(${key}:\\s*).*$`, "m");
  if (!pattern.test(source)) return null;
  return source.replace(pattern, (_match, prefix) => `${prefix}${siteUrl}`);
}

const withSite = replaceLine(yaml, "site_url");
const next = withSite ? replaceLine(withSite, "display_url") : null;
if (!next) {
  console.warn("cms-site-url: site_url or display_url was not found in out/admin/config.yml.");
  process.exit(1);
}

writeFileSync(outFile, next);
console.log("cms-site-url: updated site_url and display_url in out/admin/config.yml.");
