/**
 * Blog dates. Content stores either "YYYY-MM-DD" (older posts) or a full ISO timestamp with
 * offset (written by scripts/blog-daily.mjs and scripts/blog-refresh.mjs when content really
 * changes). Date-only values are read as 08:00 in Dubai, the business's local time.
 */
const BUSINESS_TZ = "Asia/Dubai";

export function isoDateTime(value: string | undefined | null): string {
  const v = (value || "").trim();
  if (!v) return "";
  if (v.includes("T")) return v;
  return `${v}T08:00:00+04:00`;
}

/** "YYYY-MM-DD" in Dubai time, for <time dateTime> and sitemap lastmod comparisons. */
export function dayKey(value: string | undefined | null): string {
  const iso = isoDateTime(value);
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return (value || "").slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Intl locale per site locale. English uses en-GB so dates read "29 Oct 2026". */
const DISPLAY_LOCALE: Record<string, string> = {
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  ja: "ja-JP",
  zh: "zh-CN",
};

/** Human-readable date ("29 Oct 2026", "29. Okt. 2026", "2026年10月29日"). Never returns a raw ISO string; empty on bad input. */
export function formatDisplayDate(value: string | undefined | null, locale: string): string {
  const iso = isoDateTime(value);
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(DISPLAY_LOCALE[locale] || locale || "en-GB", {
      timeZone: BUSINESS_TZ,
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(ms));
  } catch {
    return dayKey(value);
  }
}

/** Last real content change: updatedAt when it is later than publishedAt, else publishedAt. */
export function lastModified(publishedAt: string, updatedAt?: string): string {
  const p = isoDateTime(publishedAt);
  const u = isoDateTime(updatedAt);
  if (!u) return p;
  if (!p) return u;
  return Date.parse(u) > Date.parse(p) ? u : p;
}

export function wasUpdatedAfterPublishing(publishedAt: string, updatedAt?: string): boolean {
  return Boolean(updatedAt) && dayKey(updatedAt) > dayKey(publishedAt);
}

/** "October 2026", "Oktober 2026", "octobre 2026", "2026年10月", "octubre de 2026" in Dubai time; empty on bad input. */
export function formatMonthYear(value: string | Date | undefined | null, locale: string): string {
  if (!value) return "";
  const ms = value instanceof Date ? value.getTime() : Date.parse(isoDateTime(value));
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(DISPLAY_LOCALE[locale] || locale || "en-GB", {
      timeZone: BUSINESS_TZ,
      year: "numeric",
      month: "long",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}
