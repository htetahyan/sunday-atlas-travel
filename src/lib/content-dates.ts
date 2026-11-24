import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Last real edit of a CMS document, as an ISO timestamp, or undefined when unknown.
 * Key is "packages/<slug>", "destinations/<slug>", "pages/<id>" or "settings".
 *
 * Source order:
 *   1. content/.cms-updated.json: Sanity `_updatedAt`, written by scripts/sync-from-sanity.mjs on every build;
 *   2. the last git commit that touched content/<key>.json (full clones only; a shallow CI clone would
 *      report the checkout commit for every file, so it is skipped there).
 * Never the build time.
 */
let cmsMap: Record<string, string> | undefined;
let shallow: boolean | undefined;
const gitCache = new Map<string, string | undefined>();

function readCmsMap(): Record<string, string> {
  if (cmsMap) return cmsMap;
  const file = path.join(process.cwd(), "content", ".cms-updated.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { updatedAt?: Record<string, string> };
    cmsMap = raw && typeof raw.updatedAt === "object" && raw.updatedAt ? raw.updatedAt : {};
  } catch {
    cmsMap = {};
  }
  return cmsMap;
}

function isShallowClone(): boolean {
  if (shallow !== undefined) return shallow;
  try {
    shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() !== "false";
  } catch {
    shallow = true;
  }
  return shallow;
}

function gitUpdatedAt(key: string): string | undefined {
  if (gitCache.has(key)) return gitCache.get(key);
  let value: string | undefined;
  const file = key === "settings" ? "content/settings/seo.json" : `content/${key}.json`;
  if (!isShallowClone() && fs.existsSync(path.join(process.cwd(), file))) {
    try {
      value = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], { encoding: "utf8" }).trim() || undefined;
    } catch {
      value = undefined;
    }
  }
  gitCache.set(key, value);
  return value;
}

export function cmsUpdatedAt(key: string): string | undefined {
  const fromCms = readCmsMap()[key];
  if (typeof fromCms === "string" && Number.isFinite(Date.parse(fromCms))) return fromCms;
  return gitUpdatedAt(key);
}

/** Latest of several ISO timestamps; undefined when none is valid. */
export function latestDate(values: readonly (string | Date | undefined)[]): Date | undefined {
  let best: number | undefined;
  for (const v of values) {
    if (!v) continue;
    const ms = v instanceof Date ? v.getTime() : Date.parse(v);
    if (Number.isFinite(ms) && (best === undefined || ms > best)) best = ms;
  }
  return best === undefined ? undefined : new Date(best);
}
