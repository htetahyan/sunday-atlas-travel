/**
 * Find, vet and host free, legally reusable photos for blog posts, destinations and packages.
 *
 * Sources (in order):
 *   1. Wikimedia Commons API (no key). Only CC0, public domain, CC BY and CC BY-SA.
 *   2. Pexels, only when PEXELS_API_KEY is set (Pexels License; uploaded to our Cloudinary).
 *   3. Unsplash, only when UNSPLASH_ACCESS_KEY is set. Unsplash API terms require
 *      hotlinking images.unsplash.com and pinging download_location, so Unsplash
 *      photos are not re-uploaded; they keep their Unsplash URL.
 *
 * Spend-aware order (metadata is free, vision tokens are not):
 *   1. metadata only: licence, JPEG/WebP photo (no PNG/SVG graphics), long edge ≥ 2000 px,
 *      ≥ 2 MP, landscape (3:2 is fine), no logo/sign/poster/map/text/stitch-error words,
 *      source id not already used and no cached vision reject in the registry;
 *   2. rank by quality tier (Commons Featured > Quality > Valued > none), then
 *      resolution band, then relevance;
 *   3. download a ≈500 px preview of the top finalists only, pHash de-duplication;
 *   4. vision gate on at most 2 finalists per slot (stop at the first pass), and never
 *      twice for the same file: every verdict is cached in the registry;
 *   5. full-size download + upload for the winner only.
 */
import { metadataProblems, visionGate } from "./image-gate.mjs";
import { phash } from "./phash.mjs";
import { VISION_MODEL } from "./blog-ai-client.mjs";
import { duplicateOf, reservedFor, upsert } from "./image-registry.mjs";
import { uploadImage, uploadStatus, safePublicName } from "./cloudinary-upload.mjs";

export const USER_AGENT = "SundayAtlasImageFinder/1.0 (https://sundayatlastravel.com; blog images)";
export const MIN_LONG_EDGE = 2000;
export const MIN_WIDTH = MIN_LONG_EDGE; // landscape only, so the long edge is the width
export const MIN_PIXELS = 2_000_000;
export const MIN_ASPECT = 1.2; // landscape; 3:2 (1.5) and 4:3 (1.33) pass
const DELIVERY_WIDTH = 1920;
const PREVIEW_WIDTH = 500; // a standard Wikimedia thumbnail step; enough for pHash and the ≈512px gate
export const FINALISTS_PER_SLOT = 2;

/* ------------------------------------------------------------ licences */

/** Normalise a licence label. Returns null for anything we may not use. */
export function normaliseLicense(short, url = "") {
  const s = `${short ?? ""} ${url ?? ""}`.toLowerCase();
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv|all rights reserved|fair use|gfdl(?!.*cc)/.test(s)) return null;
  if (/cc0|cc-zero|publicdomain\/zero/.test(s)) return { id: "CC0", requiresCredit: false };
  if (/public domain|^\s*pd\b|\bpd-|publicdomain\/mark/.test(s)) return { id: "Public domain", requiresCredit: false };
  const ver = (s.match(/(\d\.\d)/) || [])[1] || "";
  if (/cc[ -]by[ -]sa|by-sa/.test(s)) return { id: `CC BY-SA${ver ? ` ${ver}` : ""}`, requiresCredit: true };
  if (/cc[ -]by\b|licenses\/by\//.test(s)) return { id: `CC BY${ver ? ` ${ver}` : ""}`, requiresCredit: true };
  return null;
}

export function stripHtml(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------ ranking */

const STOP = new Set(["the", "and", "of", "in", "to", "from", "day", "trip", "tour", "guide", "best", "things", "with", "for", "at", "on", "a", "an"]);

export function tokens(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Basic usability: format, size, orientation, licence. Returns a list of problems. */
export function shapeProblems(c) {
  const p = [];
  if (!/jpe?g|webp/i.test(c.mime ?? "image/jpeg")) p.push(`format ${c.mime} (photos only; no PNG/SVG/GIF/TIFF)`);
  if (!(Math.max(c.width, c.height) >= MIN_LONG_EDGE)) p.push(`long edge ${Math.max(c.width, c.height)} < ${MIN_LONG_EDGE}`);
  if (!(c.width * c.height >= MIN_PIXELS)) p.push(`${((c.width * c.height) / 1e6).toFixed(1)} MP < ${MIN_PIXELS / 1e6} MP`);
  if (!(c.width >= c.height * MIN_ASPECT)) p.push(`not landscape (${c.width}×${c.height})`);
  if (!c.license) p.push("licence not allowed");
  return p;
}

/**
 * Relevance score. `place` tokens must appear (title, categories, tags or
 * description) or the score is 0. Country and other words add a little.
 */
export function relevance(c, { place, country = "", extra = "" }) {
  const title = tokens(c.title).join(" ");
  const cats = tokens((c.categories ?? []).join(" ")).join(" ");
  const tags = tokens((c.tags ?? []).join(" ")).join(" ");
  const desc = tokens(c.description).join(" ");
  const has = (hay, t) => new RegExp(`\\b${t}`).test(hay);
  const placeT = tokens(place);
  if (!placeT.length) return 0;
  let score = 0;
  let placeHits = 0;
  for (const t of placeT) {
    const hit = has(title, t) ? 4 : has(cats, t) ? 3 : has(tags, t) ? 2 : has(desc, t) ? 1 : 0;
    if (hit) placeHits += 1;
    score += hit;
  }
  if (placeHits < Math.ceil(placeT.length / 2)) return 0;
  for (const t of tokens(`${country} ${extra}`)) if (has(`${title} ${cats} ${tags} ${desc}`, t)) score += 1;
  const ar = c.width / c.height;
  if (ar >= 1.3 && ar <= 1.9) score += 1;
  if (/\b1[789]\d\d\b|historical|archive|vintage|old photo|prokudin/i.test(`${c.title} ${(c.categories ?? []).join(" ")}`)) score -= 4;
  return score;
}

/** Commons assessment tier: 3 Featured picture, 2 Quality image, 1 Valued image, 0 none. */
export function qualityTier(c) {
  const s = `${(c.assessments ?? []).join(" ")} ${(c.categories ?? []).join(" ")}`.toLowerCase();
  if (/featured pictures|\bfeatured\b|\bpoty\b/.test(s)) return 3;
  if (/quality images|\bquality\b/.test(s)) return 2;
  if (/valued images|\bvalued\b/.test(s)) return 1;
  return 0;
}

/** Coarse resolution band so relevance still decides between similar sizes: 2 ≥ 12 MP, 1 ≥ 6 MP, 0 otherwise. */
export function resolutionBand(c) {
  const mp = (c.width * c.height) / 1e6;
  return mp >= 12 ? 2 : mp >= 6 ? 1 : 0;
}

/** Relevant candidates ranked by quality tier, then resolution band, then relevance, then pixels. */
export function rankCandidates(cands, ctx) {
  return cands
    .map((c) => ({ ...c, score: relevance(c, ctx), tier: qualityTier(c), band: resolutionBand(c), problems: [...shapeProblems(c), ...metadataProblems(c)] }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.tier - a.tier || b.band - a.band || b.score - a.score || b.width * b.height - a.width * a.height);
}

/** Commons preview URL (standard thumbnail step) from an original or thumbnail URL; query strings dropped. */
export function commonsThumb(url, width = PREVIEW_WIDTH) {
  const u = String(url ?? "").split("?")[0];
  if (/\/thumb\/.+\/\d+px-[^/]+$/.test(u)) return u.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
  const m = u.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/);
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${width}px-${m[3]}` : null;
}

/* ------------------------------------------------------------ providers */

async function getJson(url, headers = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.json();
}

export function commonsCandidate(page) {
  const ii = page.imageinfo?.[0];
  if (!ii) return null;
  const md = ii.extmetadata ?? {};
  const license = normaliseLicense(md.LicenseShortName?.value, md.LicenseUrl?.value);
  return {
    provider: "commons",
    key: `commons:${page.pageid}`,
    sourceId: String(page.pageid),
    title: page.title,
    width: ii.width,
    height: ii.height,
    mime: ii.mime,
    sha1: ii.sha1,
    downloadUrl: ii.width > DELIVERY_WIDTH && ii.thumburl ? ii.thumburl : ii.url,
    previewUrl: commonsThumb(ii.thumburl) ?? commonsThumb(ii.url) ?? (ii.width > DELIVERY_WIDTH && ii.thumburl ? ii.thumburl : ii.url),
    assessments: String(md.Assessments?.value ?? "").split("|").filter(Boolean),
    pageUrl: ii.descriptionurl,
    author: stripHtml(md.Artist?.value).slice(0, 120) || "Unknown author",
    license: license?.id ?? null,
    licenseUrl: md.LicenseUrl?.value ?? "",
    requiresCredit: license ? license.requiresCredit || md.AttributionRequired?.value === "true" : true,
    categories: [
      ...(page.categories ?? []).map((c) => c.title.replace(/^Category:/, "")),
      ...String(md.Categories?.value ?? "").split("|").filter(Boolean),
    ],
    description: stripHtml(md.ImageDescription?.value).slice(0, 400),
    tags: [],
  };
}

/** Commons search restricted to Featured pictures and Quality images (searched first). */
export const COMMONS_ASSESSED = "incategory:Featured_pictures_on_Wikimedia_Commons|Quality_images";

export async function searchCommons(query, { limit = 30, assessed = false, fetchImpl = fetch } = {}) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  Object.entries({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap filew:>${MIN_WIDTH - 1}${assessed ? ` ${COMMONS_ASSESSED}` : ""}`,
    gsrlimit: String(limit),
    prop: "imageinfo|categories",
    cllimit: "max",
    clshow: "!hidden",
    iiprop: "url|size|mime|sha1|extmetadata",
    iiurlwidth: String(DELIVERY_WIDTH),
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ImageDescription|Categories|AttributionRequired|Assessments",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const data = await getJson(url, {}, fetchImpl);
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(commonsCandidate)
    .filter(Boolean);
}

export async function searchPexels(query, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.PEXELS_API_KEY) return [];
  const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, orientation: "landscape", per_page: "20" })}`;
  const data = await getJson(url, { authorization: env.PEXELS_API_KEY }, fetchImpl);
  return (data.photos ?? []).map((p) => ({
    provider: "pexels",
    key: `pexels:${p.id}`,
    sourceId: String(p.id),
    title: p.alt || String(p.url ?? "").split("/").filter(Boolean).pop() || "",
    width: p.width,
    height: p.height,
    mime: "image/jpeg",
    downloadUrl: `${p.src?.original}?auto=compress&cs=tinysrgb&w=${DELIVERY_WIDTH}`,
    previewUrl: `${p.src?.original}?auto=compress&cs=tinysrgb&w=${PREVIEW_WIDTH}`,
    pageUrl: p.url,
    author: p.photographer || "Pexels photographer",
    license: "Pexels License",
    licenseUrl: "https://www.pexels.com/license/",
    requiresCredit: false,
    categories: [],
    description: p.alt || "",
    tags: [],
  }));
}

export async function searchUnsplash(query, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.UNSPLASH_ACCESS_KEY) return [];
  const url = `https://api.unsplash.com/search/photos?${new URLSearchParams({ query, orientation: "landscape", per_page: "20", content_filter: "high" })}`;
  const data = await getJson(url, { authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`, "accept-version": "v1" }, fetchImpl);
  return (data.results ?? []).map((p) => ({
    provider: "unsplash",
    key: `unsplash:${p.id}`,
    sourceId: p.id,
    title: p.alt_description || p.description || "",
    width: p.width,
    height: p.height,
    mime: "image/jpeg",
    downloadUrl: `${p.urls?.raw}&w=${DELIVERY_WIDTH}&fm=jpg&q=80&fit=max`,
    previewUrl: `${p.urls?.raw}&w=${PREVIEW_WIDTH}&fm=jpg&q=75&fit=max`,
    hotlinkUrl: `${p.urls?.raw}&w=${DELIVERY_WIDTH}&fm=jpg&q=80&fit=max`,
    downloadLocation: p.links?.download_location,
    pageUrl: p.links?.html,
    author: p.user?.name || "Unsplash photographer",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
    requiresCredit: true,
    categories: [],
    description: p.description || p.alt_description || "",
    tags: (p.tags ?? []).map((t) => t.title),
  }));
}

export function enabledSources(env = process.env) {
  return ["commons", ...(env.PEXELS_API_KEY ? ["pexels"] : []), ...(env.UNSPLASH_ACCESS_KEY ? ["unsplash"] : [])];
}

/* ------------------------------------------------------------ pipeline */

export async function download(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Credit object stored on the page image. */
export function creditFor(c) {
  return {
    author: c.author,
    license: c.license,
    licenseUrl: c.licenseUrl || undefined,
    sourceUrl: c.pageUrl,
    provider: c.provider,
    required: Boolean(c.requiresCredit),
  };
}

/** Search queries for a place, most specific first. */
export function queriesFor({ place, country, extra }) {
  return [...new Set([[place, extra, country].filter(Boolean).join(" "), [place, country].filter(Boolean).join(" "), place].filter(Boolean))];
}

/** Cached vision verdict for this source, if any. */
export function cachedVerdict(registry, key) {
  return registry.images.find((i) => i.key === key && i.gate && typeof i.gate.ok === "boolean")?.gate ?? null;
}

/** A cached reject applies unless its only problem was a subject mismatch for a different subject. */
export function cachedRejectApplies(gate, subject) {
  if (!gate || gate.ok) return false;
  const codes = (gate.reasons ?? []).filter((r) => /^(has_\w+|not a photo|subject mismatch)$/.test(r));
  if (codes.some((r) => r !== "subject mismatch")) return true;
  return gate.subject === subject;
}

function recordVerdict(registry, c, hash, verdict, subject) {
  upsert(registry, {
    key: c.key,
    source: { provider: c.provider, id: c.sourceId, pageUrl: c.pageUrl, author: c.author, license: c.license, licenseUrl: c.licenseUrl || undefined, title: c.title },
    phash: hash,
    gate: { model: VISION_MODEL, ok: verdict.ok, reasons: verdict.reasons ?? [], alt: verdict.alt || undefined, subject, at: new Date().toISOString().slice(0, 10) },
    uses: [],
  });
}

/**
 * Find one new image for `place` and register it for `use` ({ type, slug, field }).
 * Returns { ok, image?, reasons[], tried[], visionCalls }. With `dryRun`, nothing is uploaded;
 * the chosen candidate is returned with `src` = source page URL. Vision verdicts are
 * cached in `registry` either way (callers decide whether to save it).
 * `budget` ({ limit, used }) is shared across all slots of one post / page.
 */
export async function findImage(opts) {
  const {
    place,
    country = "",
    extra = "",
    subject = [place, country].filter(Boolean).join(", "),
    registry,
    use,
    folder,
    dryRun = false,
    gate = visionGate,
    upload = uploadImage,
    fetchImpl = fetch,
    env = process.env,
    maxGate = Number(env.IMAGE_FINDER_MAX_GATE || FINALISTS_PER_SLOT),
    budget = { limit: Infinity, used: 0 },
    log = () => {},
    searchers = { commons: searchCommons, pexels: searchPexels, unsplash: searchUnsplash },
  } = opts;
  const tried = [];
  let visionCalls = 0;
  const done = (r) => ({ ...r, tried, visionCalls });
  const canUpload = dryRun || uploadStatus(env).ok;
  if (!canUpload && !env.UNSPLASH_ACCESS_KEY) return done({ ok: false, reasons: [`no upload credential: ${uploadStatus(env).missing}`] });

  // 1–2. Metadata only: search every enabled source, filter, rank. Nothing downloaded yet.
  const seen = new Set();
  const cands = [];
  for (const provider of enabledSources(env)) {
    if (provider !== "unsplash" && !canUpload) continue;
    const passes = provider === "commons" ? [true, false] : [false]; // Commons: assessed first, then everything
    for (const q of queriesFor({ place, country, extra })) {
      for (const assessed of passes) {
        try {
          for (const c of await searchers[provider](q, { fetchImpl, env, assessed }))
            if (!seen.has(c.key)) {
              seen.add(c.key);
              cands.push(c);
            }
        } catch (err) {
          tried.push({ provider, query: q, reject: `search failed: ${err.message}` });
        }
      }
      if (cands.length >= 30) break;
    }
  }
  const finalists = [];
  for (const c of rankCandidates(cands, { place, country, extra })) {
    if (c.problems.length) tried.push({ key: c.key, reject: c.problems[0] });
    else if (registry.images.some((i) => i.key === c.key && (i.uses ?? []).length)) tried.push({ key: c.key, reject: "same source already used" });
    else if (cachedRejectApplies(cachedVerdict(registry, c.key), subject)) tried.push({ key: c.key, reject: `cached vision reject: ${cachedVerdict(registry, c.key).reasons.join("; ")}` });
    else finalists.push(c);
  }

  // 3–5. Preview + pHash for finalists in rank order; vision on at most `maxGate` of them.
  let gated = 0;
  for (const c of finalists) {
    if (gated >= maxGate) break;
    let preview;
    try {
      preview = await download(c.previewUrl || c.downloadUrl, fetchImpl);
    } catch (err) {
      tried.push({ key: c.key, reject: err.message });
      continue;
    }
    let hash;
    try {
      hash = await phash(preview);
    } catch (err) {
      tried.push({ key: c.key, reject: `undecodable: ${err.message}` });
      continue;
    }
    const dup = duplicateOf(registry, { key: c.key, phash: hash });
    if (dup) {
      tried.push({ key: c.key, reject: `${dup.why} of ${dup.entry.key}` });
      continue;
    }
    const cached = cachedVerdict(registry, c.key);
    let verdict;
    if (cached?.ok && (cached.subject === subject || !cached.subject)) verdict = { ok: true, reasons: [], alt: cached.alt ?? "" };
    else {
      if (budget.used >= budget.limit) {
        tried.push({ key: c.key, reject: `vision budget used (${budget.used}/${budget.limit})` });
        break;
      }
      gated += 1;
      visionCalls += 1;
      budget.used += 1;
      verdict = await gate(preview, { subject });
      // A failed call (network, bad JSON) is a reject now but is not cached, so it can be retried later.
      if (!(verdict.reasons ?? []).some((r) => /failed closed/.test(r))) recordVerdict(registry, c, hash, verdict, subject);
    }
    if (!verdict.ok) {
      tried.push({ key: c.key, reject: `vision: ${verdict.reasons.join("; ")}` });
      log(`      ✗ ${c.title} — ${verdict.reasons.join("; ")}`);
      continue;
    }
    const altEn = verdict.alt || subject;
    const credit = creditFor(c);
    if (dryRun)
      return done({ ok: true, image: { key: c.key, src: c.pageUrl, width: c.width, height: c.height, altEn, credit, phash: hash, tier: c.tier, candidate: c } });
    let hosted;
    if (c.provider === "unsplash") {
      if (c.downloadLocation) await getJson(c.downloadLocation, { authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` }, fetchImpl).catch(() => {});
      hosted = { publicId: null, url: c.hotlinkUrl, width: DELIVERY_WIDTH, height: Math.round((DELIVERY_WIDTH * c.height) / c.width) };
    } else {
      const reserved = reservedFor(registry, c.key);
      try {
        hosted = reserved
          ? reserved.cloudinary
          : await upload(await download(c.downloadUrl, fetchImpl), {
              folder,
              name: `${safePublicName(place)}-${c.provider}-${c.sourceId}`,
              context: { alt: altEn, caption: subject, credit: `${c.author} / ${c.license}`, source: c.pageUrl },
              env,
              fetchImpl,
            });
      } catch (err) {
        tried.push({ key: c.key, reject: err.message });
        continue;
      }
    }
    const entry = upsert(registry, {
      key: c.key,
      source: { provider: c.provider, id: c.sourceId, pageUrl: c.pageUrl, author: c.author, license: c.license, licenseUrl: c.licenseUrl || undefined, title: c.title },
      phash: hash,
      cloudinary: hosted.publicId ? { publicId: hosted.publicId, url: hosted.url, width: hosted.width, height: hosted.height } : null,
      hotlink: hosted.publicId ? undefined : hosted.url,
      uses: use ? [use] : [],
    });
    return done({ ok: true, image: { key: entry.key, src: hosted.url, width: hosted.width, height: hosted.height, altEn, credit, phash: hash } });
  }
  return done({ ok: false, reasons: [`no usable image for "${subject}" (${tried.length} candidates rejected, ${visionCalls} vision calls)`] });
}
