/**
 * Images for a new blog post: one hero + one per section, each new to the site
 * (registry), vetted by the vision gate and uploaded to Cloudinary
 * (sunday-atlas/blog/<slug>). Missing slots are filled by the caller's fallback.
 */
import { findImage, enabledSources } from "./image-finder.mjs";
import { uploadStatus } from "./cloudinary-upload.mjs";

/** Main place of a topic keyword: "things to do in Tashkent" → "Tashkent". */
export function heroPlace(keyword) {
  return String(keyword ?? "")
    .replace(/^(?:top\s+\d+\s+)?(?:things to do in|places to visit in|what to see in|best time to visit|how to get to|where to stay in|visiting|visit)\s+/i, "")
    .replace(/\s+(?:travel guide|guide|itinerary(?:\s+\d+\s+days?)?|in\s+\d+\s+days?|\d+\s+days?|day trips?.*|tours?|weather|by train|by car)$/i, "")
    .replace(/^day trip from\s+\S+\s+to\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function imageFinderStatus(env = process.env) {
  const up = uploadStatus(env);
  return {
    enabled: up.ok || Boolean(env.UNSPLASH_ACCESS_KEY),
    sources: enabledSources(env),
    upload: up.ok ? "cloudinary" : env.UNSPLASH_ACCESS_KEY ? "unsplash-hotlink-only" : "none",
    missing: up.ok ? null : up.missing,
  };
}

/**
 * @returns {Promise<{ hero: object|null, inline: (object|null)[], log: string[] }>}
 * Each image: { key, src, width, height, altEn, credit }. `visionCalls` is the gate calls spent.
 */
export async function pickPostImages({ slug, keyword, country, sections, registry, finder = findImage, env = process.env, log = () => {} }) {
  const folder = `sunday-atlas/blog/${slug}`;
  const notes = [];
  // Vision spend cap per post (≈12 calls ≈ hero + 2 finalists for most sections).
  const budget = { limit: Number(env.IMAGE_FINDER_POST_VISION_CAP || 12), used: 0 };
  const one = async (places, field) => {
    for (const place of [...new Set(places.filter(Boolean))]) {
      const r = await finder({ place, country, registry, folder, use: { type: "blog", slug, field }, env, log, budget });
      if (r.ok) {
        notes.push(`${field}: ${r.image.key} (${place})`);
        return r.image;
      }
      notes.push(`${field}: ${place} — ${r.reasons?.[0] ?? "none"}`);
    }
    return null;
  };
  const hero = await one([heroPlace(keyword), sections[0]?.placeName, country], "heroImage");
  const inline = [];
  for (const s of sections) inline.push(await one([s.placeName, s.heading && s.placeName ? null : s.heading], `sections.${s.id}.image`));
  notes.push(`vision calls: ${budget.used}/${budget.limit}`);
  return { hero, inline, log: notes, visionCalls: budget.used };
}
