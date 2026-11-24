import type { Metadata } from "next";
import { defaultOgImage } from "@/config/images";
import { isIndexable, siteName, siteUrl } from "@/config/site";
import { isLocale, localeTags, locales, type Locale } from "@/i18n/config";
import { getDictionarySync } from "@/i18n/getDictionary";
import { cldOgImage, isCloudinaryUploadUrl } from "@/lib/cloudinary";
import { getSeoSettings, pathAvailableIn, seoForPath, twitterHandleFromUrl } from "@/lib/content";
import { fill } from "@/lib/paths";

/** Social card size for a destination or package hero. */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

const META_DESCRIPTION_MAX = 155;

export type PageImage = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

export type PageMetadataInput = {
  locale: string;
  /**
   * Locale-agnostic path. Always starts and ends with `/`.
   * Home is `/`. A package is `/packages/bhutan-7-day-cultural-journey/`.
   */
  path: string;
  title: string;
  description: string;
  /** Social image. Omitted pages use the homepage hero. */
  image?: PageImage;
  /** Article pages: emits og:type=article with article:published_time / article:modified_time. */
  article?: { publishedTime: string; modifiedTime: string };
};

const TITLE_TEMPLATE = "%s | Sunday Atlas Travel";

const INDEXABLE_ROBOTS = "index, follow, max-image-preview:large, max-snippet:-1";
const HIDDEN_ROBOTS = "noindex, nofollow";

const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  de: "de_DE",
  fr: "fr_FR",
  ja: "ja_JP",
  es: "es_ES",
  zh: "zh_CN",
};

/** Public origin with no trailing slash. */
export function siteOrigin(): string {
  return siteUrl.replace(/\/+$/, "");
}

/** Absolute URL for a site-rooted asset such as `/images/hero/home.jpg`. Cloudinary URLs pass through. */
export function absoluteAssetUrl(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  const path = src.startsWith("/") ? src : `/${src}`;
  return `${siteOrigin()}${path}`;
}

/** Absolute URL for a locale-agnostic path. Home (`/`) is `${origin}/en/`. */
export function absoluteUrl(locale: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return `${siteOrigin()}/${locale}${withSlash}`;
}

/** Locales that have this page and do not mark it noindex. zh only has translated tours and destinations. */
export function indexedLocalesFor(path: string): Locale[] {
  return locales.filter((locale) => pathAvailableIn(path, locale) && !seoForPath(path, locale).noindex);
}

/**
 * hreflang map for locales that have the page and are not marked noindex, plus x-default.
 * Keys are BCP 47 tags (zh is "zh-Hans").
 * x-default points at English when that locale is included, otherwise the first included locale.
 */
export function localeAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  const included = indexedLocalesFor(path);
  for (const locale of included) {
    languages[localeTags[locale]] = absoluteUrl(locale, path);
  }
  const xDefault = included.includes("en") ? "en" : included[0];
  if (xDefault) languages["x-default"] = absoluteUrl(xDefault, path);
  return languages;
}

/** `noindex, nofollow` unless the site is indexable and this page opts in. */
export function pageRobots(noindex = false): string {
  if (!isIndexable || noindex) return HIDDEN_ROBOTS;
  return INDEXABLE_ROBOTS;
}

/** `@handle` from SEO settings, or "" when X is unset. */
export function twitterSite(): string {
  return twitterHandleFromUrl(getSeoSettings().social.x);
}

/** Verification tags. Undefined when both values are empty, so no meta is emitted. */
export function siteVerification(): Metadata["verification"] | undefined {
  const settings = getSeoSettings();
  const google = settings.googleSiteVerification;
  const bing = settings.bingSiteVerification;
  if (!google && !bing) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { "msvalidate.01": bing } } : {}),
  };
}

/**
 * Meta description from a summary: collapse whitespace and cut to ~155
 * characters on a word boundary. An empty summary returns "".
 */
export function trimMetaDescription(summary: string, max = META_DESCRIPTION_MAX): string {
  const text = summary.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const space = window.lastIndexOf(" ");
  return (space > 0 ? window.slice(0, space) : window).trim();
}

/**
 * Summary trimmed for meta description, or a localized sentence when the summary is empty.
 */
export function descriptionFromSummary(summary: string, fallback: string): string {
  return trimMetaDescription(summary) || fallback.replace(/\s+/g, " ").trim();
}

/**
 * Package document title. A translated name uses `title` (`{title}`).
 * When the locale has no name of its own, `fallbackTitle` wraps the English name
 * so the document title is not the same string in two locales.
 */
export function packagePageTitle(
  locale: string,
  templates: { title: string; fallbackTitle: string },
  title: string,
  englishTitle: string,
): string {
  const template =
    locale !== "en" && title === englishTitle ? templates.fallbackTitle : templates.title;
  return fill(template, { title });
}

/**
 * Open Graph / Twitter image for a destination or package hero.
 * Cloudinary URLs are cropped to 1200×630 JPEG. Any other non-empty path is
 * returned as-is so `absoluteAssetUrl` can prefix the site origin.
 * No hero returns undefined, and page metadata uses the site default image.
 */
export function heroOpenGraphImage(src: string | undefined, alt: string): PageImage | undefined {
  const trimmed = src?.trim() ?? "";
  if (!trimmed) return undefined;
  const url = isCloudinaryUploadUrl(trimmed) ? cldOgImage(trimmed) : trimmed;
  return {
    src: url,
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    alt: alt.trim(),
  };
}

/** Open Graph locale (`en` → `en_US`). */
export function ogLocale(locale: string): string {
  if (locale in OG_LOCALE) return OG_LOCALE[locale as Locale];
  return OG_LOCALE.en;
}

/**
 * Single metadata helper for every page.
 * Document titles stay absolute so the "%s | Sunday Atlas Travel" template
 * also applies on the locale home page (Next.js does not apply title.template there).
 */
function resolveImage(locale: string, image: PageImage | undefined): PageImage {
  if (image) return image;
  const safe: Locale = isLocale(locale) ? locale : "en";
  return {
    src: defaultOgImage.src,
    width: defaultOgImage.width,
    height: defaultOgImage.height,
    alt: getDictionarySync(safe).home.heroImageAlt,
  };
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function applyTitleTemplate(template: string, title: string): string {
  if (template.includes("%s")) return template.replace("%s", title);
  return TITLE_TEMPLATE.replace("%s", title);
}

/** Absolute URL for a CMS canonical override, or the page's own URL when empty. */
function resolveCanonical(locale: string, path: string, override: string): string {
  if (!override) return absoluteUrl(locale, path);
  if (override.startsWith("http://") || override.startsWith("https://")) return override;
  const localePath = new RegExp(`^/(${locales.join("|")})(/|$)`);
  if (override.startsWith("/") && localePath.test(override)) {
    const withSlash = override.endsWith("/") ? override : `${override}/`;
    return `${siteOrigin()}${withSlash}`;
  }
  return absoluteUrl(locale, override.startsWith("/") ? override : `/${override}`);
}

/** Focus keyword first, then the list. Defaults only when both are empty. */
function metaKeywords(focus: string, list: string[], defaults: string[]): string | undefined {
  const source = focus || list.length > 0 ? [focus, ...list].filter((item) => item.length > 0) : defaults;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of source) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.length > 0 ? out.join(", ") : undefined;
}

export function buildPageMetadata({
  locale,
  path,
  title,
  description,
  image,
  article,
}: PageMetadataInput): Metadata {
  const safe: Locale = isLocale(locale) ? locale : "en";
  const settings = getSeoSettings();
  const seo = seoForPath(path, safe);
  const template = settings.titleTemplate[safe] || TITLE_TEMPLATE;
  const documentTitle = seo.seoTitle.trim() || applyTitleTemplate(template, title);
  const socialTitle = seo.seoTitle.trim() || title;
  const resolvedDescription =
    oneLine(seo.metaDescription) || oneLine(description) || settings.defaultDescription[safe];
  const canonical = resolveCanonical(safe, path, seo.canonical);
  const currentOg = ogLocale(safe);
  const overrideImage = seo.ogImage
    ? heroOpenGraphImage(seo.ogImage, image?.alt || socialTitle)
    : undefined;
  const photo = resolveImage(safe, overrideImage ?? image);
  const socialImage = {
    url: absoluteAssetUrl(photo.src),
    width: photo.width,
    height: photo.height,
    alt: photo.alt,
  };
  const keywords = metaKeywords(seo.focusKeyword, seo.keywords, settings.defaultKeywords[safe]);
  const handle = twitterSite();
  return {
    metadataBase: new URL(siteOrigin()),
    title: { absolute: documentTitle },
    description: resolvedDescription,
    ...(keywords ? { keywords } : {}),
    robots: pageRobots(seo.noindex),
    alternates: {
      canonical,
      languages: localeAlternates(path),
    },
    openGraph: {
      ...(article
        ? {
            type: "article" as const,
            publishedTime: article.publishedTime,
            modifiedTime: article.modifiedTime,
          }
        : { type: "website" as const }),
      siteName,
      title: socialTitle,
      description: resolvedDescription,
      url: canonical,
      locale: currentOg,
      alternateLocale: indexedLocalesFor(path)
        .map((item) => ogLocale(item))
        .filter((item) => item !== currentOg),
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      ...(handle ? { site: handle } : {}),
      title: socialTitle,
      description: resolvedDescription,
      images: [socialImage],
    },
  };
}
