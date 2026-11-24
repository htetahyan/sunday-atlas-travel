/**
 * Year used as the "freshness" label in blog titles, keywords and copy ("Best time to visit X in 2027").
 * Rule: from November onward we label content for NEXT year, otherwise the current year (Asia/Dubai).
 */
export function targetYear(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "numeric", timeZone: "Asia/Dubai" })
    .formatToParts(now).filter((p) => p.type !== "literal").map((p) => Number(p.value));
  return m >= 11 ? y + 1 : y;
}

const SEASON_RE = /harbin|ice (and snow )?festival|eisfestival|festival de (glace|hielo)|ハルビン|哈尔滨|winter season|season/i;
const DATE_BEFORE_RE = /\d{1,2}(st|nd|rd|th)?\.?\s*(de\s+)?[A-Za-zÀ-ÿ]+\.?\s*(de\s+)?$/; // "1 Nov ", "1. November ", "1 de noviembre de "

/**
 * Rewrite stale year labels (e.g. 2026) to the target year in one string. Keeps real dates:
 * ISO dates (2026-11-02), day-month-year dates (1 Nov 2026), and ranges ending in the stale year
 * (winter 2025–2026). "2026–2027" collapses to "2027" except for festival/season ranges (Harbin 2026–2027).
 * Returns { text, count }.
 */
export function fixYearLabels(text, target = targetYear(), { keepSeasons = true } = {}) {
  if (typeof text !== "string") return { text, count: 0 };
  const stale = String(target - 1);
  if (!text.includes(stale)) return { text, count: 0 };
  let count = 0;
  const season = keepSeasons && SEASON_RE.test(text);
  let out = text.replace(new RegExp(`${stale}\\s*[–-]\\s*${target}(?![\\d-])`, "g"), (m) => {
    if (season) return m;
    count++;
    return String(target);
  });
  out = out.replace(new RegExp(`(?<![\\d/–-])${stale}(?![\\d]|\\s*[–/-]\\s*\\d)`, "g"), (m, off, s) => {
    if (DATE_BEFORE_RE.test(s.slice(Math.max(0, off - 30), off))) return m;
    count++;
    return String(target);
  });
  return { text: out, count };
}

const SKIP_KEYS = new Set(["lastUpdated", "effectiveDate", "slug", "at", "publishedAt", "updatedAt", "date", "url", "href", "image", "src", "file", "id", "_id"]);

/** Deep-apply fixYearLabels to every string in an object (skipping slugs, URLs and timestamps). Mutates; returns count. */
export function fixYearLabelsDeep(obj, target = targetYear(), opts = {}) {
  let total = 0;
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach((v, i) => { if (typeof v === "string") { const r = fixYearLabels(v, target, opts); o[i] = r.text; total += r.count; } else walk(v); });
    else if (o && typeof o === "object")
      for (const [k, v] of Object.entries(o)) {
        if (SKIP_KEYS.has(k)) continue;
        if (typeof v === "string") { const r = fixYearLabels(v, target, opts); o[k] = r.text; total += r.count; } else walk(v);
      }
  };
  walk(obj);
  return total;
}
