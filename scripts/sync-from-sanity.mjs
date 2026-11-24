import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(rootDir, "content");

const projectId = (
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||
  process.env.SANITY_PROJECT_ID ||
  "mi09tcmc"
).trim();
const dataset = (
  process.env.NEXT_PUBLIC_SANITY_DATASET ||
  process.env.SANITY_DATASET ||
  "production"
).trim();
const apiVersion = (process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01").trim();
const token = (process.env.SANITY_API_READ_TOKEN || "").trim();

const SANITY_META_KEYS = new Set([
  "_id",
  "_type",
  "_rev",
  "_createdAt",
  "_updatedAt",
  "_key",
  "pageId",
  "settingKey",
]);

// Private fields that must never reach content/ (and so never the public build), even if
// someone adds them to a public Sanity document. Supplier records live only in the optional
// private file outside this repository and in private Sanity docs "suppliers.<slug>" (type packageSupplier).
const PRIVATE_KEYS = new Set(["supplier", "suppliers", "supplierName", "supplierContact", "supplierPriceRule"]);

function stripSanityKeys(value) {
  if (Array.isArray(value)) {
    return value.map(stripSanityKeys);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SANITY_META_KEYS.has(k) || PRIVATE_KEYS.has(k)) continue;
      out[k] = stripSanityKeys(v);
    }
    return out;
  }
  return value;
}

function alignKeyOrder(incoming, template) {
  if (Array.isArray(incoming)) {
    return incoming.map((item, idx) =>
      Array.isArray(template) && template[idx] !== undefined
        ? alignKeyOrder(item, template[idx])
        : item,
    );
  }
  if (
    incoming &&
    typeof incoming === "object" &&
    template &&
    typeof template === "object" &&
    !Array.isArray(template)
  ) {
    const out = {};
    for (const key of Object.keys(template)) {
      if (key in incoming) {
        out[key] = alignKeyOrder(incoming[key], template[key]);
      }
    }
    for (const [key, val] of Object.entries(incoming)) {
      if (!(key in out)) {
        out[key] = val;
      }
    }
    return out;
  }
  return incoming;
}

function writeOrderedJson(filePath, incomingObj) {
  let ordered = incomingObj;
  if (existsSync(filePath)) {
    try {
      const existing = JSON.parse(readFileSync(filePath, "utf8"));
      ordered = alignKeyOrder(incomingObj, existing);
    } catch {
      // ignore parse error
    }
  }
  writeFileSync(filePath, JSON.stringify(ordered, null, 2) + "\n", "utf8");
}

function readLocalJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** ms since epoch for "YYYY-MM-DD" (taken as 00:00 Asia/Dubai) or a full ISO timestamp; 0 if missing. */
function dateValue(value) {
  if (typeof value !== "string" || !value) return 0;
  const iso = /T/.test(value) ? value : `${value}T00:00:00+04:00`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

async function querySanity(groq) {
  const version = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  const host = token ? `${projectId}.api.sanity.io` : `${projectId}.apicdn.sanity.io`;
  const url = new URL(`https://${host}/${version}/data/query/${dataset}`);
  url.searchParams.set("query", groq);

  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sanity API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.result || [];
}

async function main() {
  if (!projectId || projectId === "sunday-atlas-cms") {
    console.log(
      "ℹ [cms:pull] NEXT_PUBLIC_SANITY_PROJECT_ID is not set — keeping local JSON files in content/.",
    );
    console.log(
      "  To sync live documents from Sanity, run: NEXT_PUBLIC_SANITY_PROJECT_ID=<id> npm run cms:pull",
    );
    return;
  }

  console.log(`🔄 [cms:pull] Fetching live dataset "${dataset}" from Sanity project "${projectId}"...`);
  const docs = await querySanity(
    `*[_type in ["destination", "travelPackage", "staticPage", "blogPost", "siteSettings"]]`,
  );

  if (!Array.isArray(docs) || docs.length === 0) {
    console.log("⚠ [cms:pull] Sanity returned 0 documents — keeping existing content/ JSON files.");
    return;
  }

  mkdirSync(join(contentDir, "destinations"), { recursive: true });
  mkdirSync(join(contentDir, "packages"), { recursive: true });
  mkdirSync(join(contentDir, "pages"), { recursive: true });
  mkdirSync(join(contentDir, "settings"), { recursive: true });
  mkdirSync(join(contentDir, "blog"), { recursive: true });

  // Real last-edit time of each CMS document (Sanity _updatedAt), read by app/sitemap.ts for
  // <lastmod> and by the package "Prices checked" line. Written next to content/, never committed.
  const updatedAt = {};
  const merged = new Map(
    (readLocalJson(join(contentDir, "blog-merged.json"))?.merged ?? []).map((m) => [m.from, m.to]),
  );

  let destCount = 0;
  let pkgCount = 0;
  let pageCount = 0;
  let settingsCount = 0;
  let blogCount = 0;
  const keptNewer = [];

  for (const doc of docs) {
    if (doc._type === "destination" && doc.slug) {
      const clean = stripSanityKeys(doc);
      writeOrderedJson(join(contentDir, "destinations", `${doc.slug}.json`), clean);
      if (doc._updatedAt) updatedAt[`destinations/${doc.slug}`] = doc._updatedAt;
      destCount++;
    } else if (doc._type === "travelPackage" && doc.slug) {
      const clean = stripSanityKeys(doc);
      writeOrderedJson(join(contentDir, "packages", `${doc.slug}.json`), clean);
      if (doc._updatedAt) updatedAt[`packages/${doc.slug}`] = doc._updatedAt;
      pkgCount++;
    } else if (doc._type === "staticPage" && doc.pageId) {
      const clean = stripSanityKeys(doc);
      writeOrderedJson(join(contentDir, "pages", `${doc.pageId}.json`), clean);
      if (doc._updatedAt) updatedAt[`pages/${doc.pageId}`] = doc._updatedAt;
      pageCount++;
    } else if (doc._type === "blogPost" && doc.slug) {
      const clean = stripSanityKeys(doc);
      // A post merged into another one (content/blog-merged.json) stays unpublished whatever its
      // Sanity copy says; public/_redirects sends its URLs to the post it was merged into.
      if (merged.has(doc.slug)) {
        clean.published = false;
        clean.mergedInto = merged.get(doc.slug);
      }
      const filePath = join(contentDir, "blog", `${doc.slug}.json`);
      // The daily blog job (scripts/blog-daily.mjs / blog-refresh.mjs) commits refreshed posts to
      // the repo. Keep a local post that is newer than Sanity's copy so a deploy never rolls it back.
      const local = readLocalJson(filePath);
      if (local && dateValue(local.updatedAt) > dateValue(clean.updatedAt)) {
        keptNewer.push(doc.slug);
        continue;
      }
      writeOrderedJson(filePath, clean);
      blogCount++;
    } else if (doc._type === "siteSettings") {
      const clean = stripSanityKeys(doc);
      const { turnstile_site_key, ...seoFields } = clean;
      writeOrderedJson(join(contentDir, "settings", "seo.json"), seoFields);
      if (turnstile_site_key) {
        writeOrderedJson(join(contentDir, "settings", "turnstile.json"), {
          _comment:
            "Public Turnstile site key for the inquiry form (widget 'Sunday Atlas inquiry', Managed, hostnames sundayatlastravel.com and www). The secret key lives only in the Pages secret TURNSTILE_SECRET_KEY.",
          site_key: turnstile_site_key,
        });
      }
      if (doc._updatedAt) updatedAt.settings = doc._updatedAt;
      settingsCount++;
    }
  }
  writeFileSync(
    join(contentDir, ".cms-updated.json"),
    JSON.stringify({ _comment: "Sanity _updatedAt per document, written by scripts/sync-from-sanity.mjs. Not committed.", updatedAt }, null, 2) + "\n",
    "utf8",
  );

  console.log(
    `✓ [cms:pull] Synced ${docs.length} documents from Sanity (${destCount} destinations, ${pkgCount} packages, ${pageCount} pages, ${blogCount} blogPosts, ${settingsCount} settings).`,
  );
  if (keptNewer.length) {
    console.log(`  ↳ kept ${keptNewer.length} local blog post(s) newer than Sanity: ${keptNewer.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("❌ [cms:pull] Failed to sync from Sanity:", err.message || err);
  process.exit(1);
});
