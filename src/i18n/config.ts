export const locales = ["en", "de", "fr", "ja", "es", "zh"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Endonyms. The language switcher uses the current dictionary for translated names. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  ja: "日本語",
  es: "Español",
  zh: "中文",
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/**
 * Locales that only carry the tours and destinations that have their own copy
 * (Simplified Chinese, added Nov 2026). The site UI, legal pages and enquiry form
 * exist in full; a tour or destination gets a /zh/ page only once its zh fields
 * are filled (scripts/zh-translate-next.mjs, every 3 hours). No blog in zh.
 */
export const partialLocales: readonly Locale[] = ["zh"];

export function isPartialLocale(locale: string): boolean {
  return (partialLocales as readonly string[]).includes(locale);
}

/** BCP 47 tag for <html lang> and hreflang. zh is Simplified Chinese. */
export const localeTags: Record<Locale, string> = {
  en: "en",
  de: "de",
  fr: "fr",
  ja: "ja",
  es: "es",
  zh: "zh-Hans",
};

/** Locales that have a blog. */
export function hasBlog(locale: string): boolean {
  return !isPartialLocale(locale);
}
