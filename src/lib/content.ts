import fs from "node:fs";
import path from "node:path";
import { hasBlog, isLocale, isPartialLocale, locales, type Locale } from "@/i18n/config";
import { getDictionarySync } from "@/i18n/getDictionary";
import { fill } from "@/lib/paths";
import { pendingSocialUrls } from "@/config/site";

/**
 * Journey copy is stored per locale. English is required. de, fr, ja, and es
 * fall back to English when missing or empty. Decap CMS edits the JSON from /admin.
 */

export type Localized<T> = {
  en: T;
  de?: T;
  fr?: T;
  ja?: T;
  es?: T;
  zh?: T;
};

const LOCALE_KEYS = ["en", "de", "fr", "ja", "es", "zh"] as const;

/**
 * Safe defaults for fields that `public/admin/config.yml` does not mark
 * `required: true`. `published` follows that file's `default:` (false).
 * `heroGradient` matches the CMS default pair.
 */
const PUBLISHED_DEFAULT = false;
const SAMPLE_DEFAULT = false;
const HERO_GRADIENT_DEFAULT: [string, string] = ["#0E4F57", "#1C2430"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalized<T>(value: Localized<T> | T): value is Localized<T> {
  if (!isRecord(value)) return false;
  return LOCALE_KEYS.some((key) => key in value);
}

function readLocale<T>(value: Localized<T>, locale: string): T | undefined {
  if (!LOCALE_KEYS.includes(locale as (typeof LOCALE_KEYS)[number])) return undefined;
  return value[locale as keyof Localized<T>];
}

/** A translation counts when it is a non-empty string or a non-empty array. */
function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

/**
 * Locale text, or English when that locale is missing or empty.
 * A plain string or array is returned as-is (legacy English-only copy).
 */
export function pick<T>(value: Localized<T> | T, locale: string): T {
  if (!isLocalized(value)) return value;
  if (locale !== "en") {
    const chosen = readLocale(value, locale);
    if (hasContent(chosen)) return chosen as T;
  }
  return value.en;
}

/** True for English, or when the locale has a non-empty string or array. */
export function isTranslated<T>(value: Localized<T> | T, locale: string): boolean {
  if (locale === "en") return true;
  if (!isLocalized(value)) return false;
  return hasContent(readLocale(value, locale));
}

/** Attribution kept with photos from Wikimedia Commons, Pexels or Unsplash. */
export type ImageCredit = {
  author: string;
  license: string;
  licenseUrl?: string;
  sourceUrl?: string;
  provider?: string;
  /** The licence requires a visible credit line (CC BY, CC BY-SA, Unsplash). */
  required: boolean;
};

export type LocalizedImage = {
  src: string;
  width: number;
  height: number;
  alt: Localized<string>;
  credit?: ImageCredit;
};

export function asImageCredit(value: unknown): ImageCredit | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  const author = str(v.author);
  const license = str(v.license);
  if (!author || !license) return undefined;
  const url = (x: unknown) => {
    const s = str(x);
    return s && /^https:\/\//.test(s) ? s : undefined;
  };
  return {
    author,
    license,
    licenseUrl: url(v.licenseUrl),
    sourceUrl: url(v.sourceUrl),
    provider: str(v.provider),
    required: v.required === true,
  };
}

/** Alt text for a content image. Unknown, empty, or missing locales fall back to English. */
export function imageAlt(
  image: { alt?: Partial<Record<string, string | undefined>> } | undefined,
  locale: string,
): string {
  const alt = image?.alt;
  if (!alt) return "";
  const text = alt[locale];
  if (typeof text === "string" && text.length > 0) return text;
  return typeof alt.en === "string" ? alt.en : "";
}

/** One gallery frame. `alt.en` is required; other locales fall back through `pick`. */
export type GalleryImage = {
  image: { src: string; width: number; height: number };
  alt: Localized<string>;
};

/** Gallery frame resolved to one locale: pixel size plus a plain alt string. */
export type LocalizedGalleryItem = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

/** Locale string, or "" when the field was omitted or is not a string. English fills an empty locale. */
function pickedString(value: Localized<string> | string | undefined, locale: string): string {
  if (typeof value === "string") return value;
  if (value == null || !isLocalized(value)) return "";
  const chosen = pick(value, locale);
  if (typeof chosen === "string" && chosen.length > 0) return chosen;
  return typeof value.en === "string" ? value.en : "";
}

/**
 * Heading override for this locale only. Empty when that locale is missing.
 * English does not fill other locales, so a German page keeps the automatic H1.
 */
function pickedLocaleOnly(value: Localized<string> | undefined, locale: string): string {
  if (value == null || !isLocalized(value)) return "";
  const chosen = readLocale(value, locale);
  return typeof chosen === "string" ? chosen.trim() : "";
}

function localizeHeadings<K extends string>(
  headings: Record<K, Localized<string>>,
  keys: readonly K[],
  locale: string,
): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    out[key] = pickedLocaleOnly(headings[key], locale);
  }
  return out;
}

/** Complete question/answer pairs for one locale. English fills an empty locale. */
export function localizeFaqs(
  faqs: FaqEntry[] | undefined,
  locale: string,
): { q: string; a: string }[] {
  return (faqs ?? []).flatMap((item) => {
    const q = pickedString(item.q, locale);
    const a = pickedString(item.a, locale);
    if (!q || !a) return [];
    return [{ q, a }];
  });
}

/**
 * FAQ H2 for this locale only. Empty when that locale is missing, so the page
 * keeps the dictionary title. English does not fill other locales.
 */
export function localizeFaqTitle(value: Localized<string> | undefined, locale: string): string {
  return pickedLocaleOnly(value, locale);
}

/**
 * Content sections for this locale only. An item is omitted unless both the
 * heading and the body are non-empty in that locale. English does not fill
 * other locales.
 */
export function localizePageSections(
  sections: PageSection[] | undefined,
  locale: string,
): { heading: string; body: string }[] {
  return (sections ?? []).flatMap((item) => {
    const heading = pickedLocaleOnly(item.heading, locale);
    const body = pickedLocaleOnly(item.body, locale);
    if (!heading || !body) return [];
    return [{ heading, body }];
  });
}

/** Locale string list, or [] when the field was omitted or is not a list. */
function pickedList(value: Localized<string[]> | string[] | undefined, locale: string): string[] {
  if (Array.isArray(value)) return stringItems(value);
  if (value == null || !isLocalized(value)) return [];
  return stringItems(pick(value, locale));
}

function stringItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * Alt for one gallery frame. CMS stores it beside `image`
 * (`{ image: { src, width, height }, alt: { en, de, … } }`). A flat image
 * may nest `alt` on the image object instead. Missing alt stays "".
 */
function galleryAlt(item: GalleryImage, locale: string): string {
  const sibling = pickedString(item.alt, locale);
  if (sibling.length > 0) return sibling;
  const nested = (item.image as { alt?: Localized<string> | string } | undefined)?.alt;
  return pickedString(nested, locale);
}

/** Localized gallery items. An absent or broken gallery is an empty list. */
export function localizeGallery(
  gallery: GalleryImage[] | undefined,
  locale: string,
): LocalizedGalleryItem[] {
  return (gallery ?? []).flatMap((item) => {
    const src = item?.image?.src;
    if (typeof src !== "string" || src.length === 0) return [];
    return [
      {
        src,
        width: typeof item.image.width === "number" ? item.image.width : 0,
        height: typeof item.image.height === "number" ? item.image.height : 0,
        alt: galleryAlt(item, locale),
      },
    ];
  });
}

/** Optional per-locale search fields. Empty strings mean "use the automatic value". */
export type LocaleSeo = {
  seoTitle: string;
  metaDescription: string;
  focusKeyword: string;
  keywords: string[];
  ogImage: string;
  canonical: string;
  noindex: boolean;
};

export type SeoByLocale = Record<Locale, LocaleSeo>;

export type FaqEntry = {
  q: Localized<string>;
  a: Localized<string>;
};

/** Optional H2 plus body on a static page. Both are localized; either may be empty. */
export type PageSection = {
  heading: Localized<string>;
  body: Localized<string>;
};

export const DESTINATION_HEADING_KEYS = ["h1", "seasons", "highlights", "faq", "packages"] as const;
export type DestinationHeadingKey = (typeof DESTINATION_HEADING_KEYS)[number];
export type DestinationHeadings = Record<DestinationHeadingKey, Localized<string>>;

export const PACKAGE_HEADING_KEYS = [
  "h1",
  "facts",
  "itinerary",
  "included",
  "notIncluded",
  "prices",
  "addOns",
  "hotels",
  "vehicles",
  "faq",
] as const;
export type PackageHeadingKey = (typeof PACKAGE_HEADING_KEYS)[number];
export type PackageHeadings = Record<PackageHeadingKey, Localized<string>>;

export type Destination = {
  slug: string;
  name: Localized<string>;
  region: Localized<string>;
  summary: Localized<string>;
  intro: Localized<string>;
  faqs: FaqEntry[];
  headings: DestinationHeadings;
  bestSeasons: Localized<string[]>;
  highlights: Localized<string[]>;
  visaNote: Localized<string>;
  heroGradient: [string, string];
  image?: LocalizedImage;
  gallery: GalleryImage[];
  sample: boolean;
  published: boolean;
  seo: SeoByLocale;
};

export type ItineraryDay = {
  day: number;
  title: Localized<string>;
  description: Localized<string>;
  /** Optional, for example "Breakfast, lunch". Empty hides the line. */
  meals: Localized<string>;
  image?: GalleryImage;
};

/** One price-table row. `prices` lines up with `groupSizes`. A non-empty `singleSupplement` is shown verbatim; an empty one renders as the on-request label. */
export type PriceTableRow = {
  label: Localized<string>;
  prices: number[];
  singleSupplement: string;
};

/**
 * Header of the row-label column. `auto` shows Hotels when the row labels name
 * a hotel class (for example "3* hotels") and Tour type otherwise.
 */
export type PriceRowHeader = "auto" | "hotels" | "tourType" | "option";

const PRICE_ROW_HEADERS: readonly PriceRowHeader[] = ["auto", "hotels", "tourType", "option"];

/** Optional price grid. Missing or empty hides the prices section. */
export type PriceTable = {
  caption: Localized<string>;
  groupSizes: Localized<string[]>;
  rows: PriceTableRow[];
  note: Localized<string>;
  rowHeader: PriceRowHeader;
};

export type HotelStay = {
  city: Localized<string>;
  standard: Localized<string>;
  superior: Localized<string>;
};

export type VehicleOption = {
  group: Localized<string>;
  vehicle: Localized<string>;
};

export type TravelPackage = {
  slug: string;
  title: Localized<string>;
  /** Primary destination slug. */
  destination: string;
  /** Extra destination slugs. Combined with `destination` by `packageCountries`. */
  countries: string[];
  /** Optional geographical region override. Empty inherits from `destination` / `countries`. */
  region: Localized<string>;
  durationDays: number;
  /** Missing, null, blank, or 0 omits nights from the duration line. */
  nights: number | undefined;
  /** True for 1-day tours or when explicitly marked as a day tour in CMS. */
  isDayTour: boolean;
  /** Private group cap. Missing hides the group-size fact. */
  maxGroupSize: number | undefined;
  style: Localized<string>;
  /** Shown on the At a glance grid when the locale has text. */
  seasonNote: Localized<string>;
  summary: Localized<string>;
  intro: Localized<string>;
  faqs: FaqEntry[];
  headings: PackageHeadings;
  itinerary: ItineraryDay[];
  included: Localized<string[]>;
  notIncluded: Localized<string[]>;
  /** Missing, null, or blank in the CMS. An offer needs both this and `currency`. */
  priceFrom: number | undefined;
  currency: string | undefined;
  priceNote: Localized<string>;
  /** Shown verbatim. Empty falls back to “Price on request”. */
  fromLabel: Localized<string>;
  priceTable?: PriceTable;
  hotels: HotelStay[];
  vehicles: VehicleOption[];
  changeNote: Localized<string>;
  trainNote: Localized<string>;
  /** Package slugs offered as optional add-on trips. Unknown slugs are ignored. */
  addOns: string[];
  image?: LocalizedImage;
  gallery: GalleryImage[];
  sample: boolean;
  /** True when highlighted on the homepage Featured Packages section. */
  featured: boolean;
  published: boolean;
  seo: SeoByLocale;
};

/**
 * Destination slugs for a package, primary first, then extras.
 * Blanks and repeats are dropped. Order is kept.
 */
export function packageCountries(pkg: {
  destination?: string;
  countries?: readonly string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of [pkg.destination ?? "", ...(pkg.countries ?? [])]) {
    const trimmed = typeof slug === "string" ? slug.trim() : "";
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Price digits as stored, with a leading "$".
 * No thousands separators and no rounding. 7297 becomes "$7297".
 */
export function formatStoredPrice(value: number): string {
  if (!Number.isFinite(value)) return "";
  const negative = value < 0;
  const abs = Math.abs(value);
  return `${negative ? "-" : ""}$${String(abs)}`;
}

/**
 * Duration line for package pages and cards.
 * Nights of 0 are omitted. One night with more than one day uses the singular night template.
 * One day with no nights uses the singular day template.
 */
export function formatPackageDuration(
  durationDays: number,
  nights: number | undefined,
  labels: {
    duration: string;
    durationDay: string;
    durationNights: string;
    durationOneNight: string;
  },
): string {
  if (!(durationDays > 0)) return "";
  if (typeof nights === "number" && nights > 0) {
    if (nights === 1 && durationDays > 1) {
      return fill(labels.durationOneNight, { days: durationDays });
    }
    return fill(labels.durationNights, { days: durationDays, nights });
  }
  if (durationDays === 1) return fill(labels.durationDay, { days: durationDays });
  return fill(labels.duration, { days: durationDays });
}

/** Plain-string view of a destination for one locale. */
export function localizeDestination(destination: Destination, locale: string) {
  return {
    slug: destination.slug,
    name: pickedString(destination.name, locale),
    region: pickedString(destination.region, locale),
    summary: pickedString(destination.summary, locale),
    bestSeasons: pickedList(destination.bestSeasons, locale),
    highlights: pickedList(destination.highlights, locale),
    visaNote: pickedString(destination.visaNote, locale),
    intro: pickedString(destination.intro, locale),
    faqs: localizeFaqs(destination.faqs, locale),
    headings: localizeHeadings(destination.headings, DESTINATION_HEADING_KEYS, locale),
    heroGradient: destination.heroGradient,
    image: destination.image,
    gallery: localizeGallery(destination.gallery, locale),
    sample: destination.sample,
    published: destination.published,
  };
}

function localizePriceTable(table: PriceTable | undefined, locale: string) {
  if (!table) return undefined;
  const caption = pickedString(table.caption, locale).trim();
  const groupSizes = pickedList(table.groupSizes, locale);
  const note = pickedString(table.note, locale).trim();
  const rows = table.rows.flatMap((row) => {
    const label = pickedString(row.label, locale).trim();
    const singleSupplement = row.singleSupplement.trim();
    if (!label && row.prices.length === 0 && !singleSupplement) return [];
    return [{ label, prices: row.prices, singleSupplement }];
  });
  if (!caption && groupSizes.length === 0 && rows.length === 0 && !note) return undefined;
  return { caption, groupSizes, rows, note, rowHeader: resolvePriceRowHeader(table) };
}

const HOTEL_CLASS_LABEL = /hot[eé]l|ホテル|\d\s*\*|★/i;

/** `hotels` when any row label (any locale) names a hotel class, else `tourType`. A CMS choice other than `auto` wins. */
function resolvePriceRowHeader(table: PriceTable): Exclude<PriceRowHeader, "auto"> {
  if (table.rowHeader !== "auto") return table.rowHeader;
  const hotelPriced = table.rows.some((row) =>
    Object.values(row.label).some((label) => typeof label === "string" && HOTEL_CLASS_LABEL.test(label)),
  );
  return hotelPriced ? "hotels" : "tourType";
}

function localizeHotels(hotels: HotelStay[], locale: string) {
  return hotels.flatMap((stay) => {
    const city = pickedString(stay.city, locale).trim();
    const standard = pickedString(stay.standard, locale).trim();
    const superior = pickedString(stay.superior, locale).trim();
    if (!city && !standard && !superior) return [];
    return [{ city, standard, superior }];
  });
}

function localizeVehicles(vehicles: VehicleOption[], locale: string) {
  return vehicles.flatMap((item) => {
    const group = pickedString(item.group, locale).trim();
    const vehicle = pickedString(item.vehicle, locale).trim();
    if (!group && !vehicle) return [];
    return [{ group, vehicle }];
  });
}

/** Plain-string view of a package for one locale. Day numbers and prices stay numbers. */
export function localizePackage(travelPackage: TravelPackage, locale: string) {
  return {
    slug: travelPackage.slug,
    title: pickedString(travelPackage.title, locale),
    destination: travelPackage.destination,
    countries: travelPackage.countries,
    region: pickedString(travelPackage.region, locale).trim(),
    durationDays: travelPackage.durationDays,
    nights: travelPackage.nights,
    isDayTour: travelPackage.isDayTour,
    maxGroupSize: travelPackage.maxGroupSize,
    style: pickedString(travelPackage.style, locale),
    seasonNote: pickedString(travelPackage.seasonNote, locale).trim(),
    summary: pickedString(travelPackage.summary, locale),
    intro: pickedString(travelPackage.intro, locale),
    faqs: localizeFaqs(travelPackage.faqs, locale),
    headings: localizeHeadings(travelPackage.headings, PACKAGE_HEADING_KEYS, locale),
    itinerary: (travelPackage.itinerary ?? []).flatMap((day) => {
      const title = pickedString(day.title, locale);
      const description = pickedString(day.description, locale);
      const meals = pickedString(day.meals, locale).trim();
      const image = day.image ? localizeGallery([day.image], locale)[0] : undefined;
      if (!title && !description && !meals && !image) return [];
      return [
        {
          day: day.day,
          title,
          description,
          ...(meals ? { meals } : {}),
          ...(image ? { image } : {}),
        },
      ];
    }),
    included: pickedList(travelPackage.included, locale),
    notIncluded: pickedList(travelPackage.notIncluded, locale),
    priceFrom: travelPackage.priceFrom,
    currency: travelPackage.currency,
    priceNote: pickedString(travelPackage.priceNote, locale),
    fromLabel: pickedString(travelPackage.fromLabel, locale).trim(),
    priceTable: localizePriceTable(travelPackage.priceTable, locale),
    hotels: localizeHotels(travelPackage.hotels, locale),
    vehicles: localizeVehicles(travelPackage.vehicles, locale),
    changeNote: pickedString(travelPackage.changeNote, locale).trim(),
    trainNote: pickedString(travelPackage.trainNote, locale).trim(),
    addOns: travelPackage.addOns,
    image: travelPackage.image,
    gallery: localizeGallery(travelPackage.gallery, locale),
    sample: travelPackage.sample,
    featured: travelPackage.featured,
    published: travelPackage.published,
    seo: travelPackage.seo,
  };
}

// Static export inputs are immutable within one production worker. Avoid reparsing
// and normalizing the whole catalog for every sitemap locale/alternate lookup.
// Development deliberately bypasses this cache so CMS edits remain visible.
const catalogSnapshots = new Map<string, unknown>();
function catalogSnapshot<T>(key: string, load: () => T[]): T[] {
  if (process.env.NODE_ENV !== "production") return load();
  if (!catalogSnapshots.has(key)) catalogSnapshots.set(key, load());
  return (catalogSnapshots.get(key) as T[]).slice();
}

function readJsonDir(folder: string): unknown[] {
  const dir = path.join(process.cwd(), "content", folder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      return JSON.parse(raw) as unknown;
    });
}

/** `{ en: "" }` when the CMS omitted a localized string. Other locales are kept. */
function asLocalizedString(value: unknown, englishFallback = ""): Localized<string> {
  const out: Localized<string> = { en: englishFallback };
  if (typeof value === "string") {
    out.en = value;
    return out;
  }
  if (!isRecord(value)) return out;
  if (typeof value.en === "string") out.en = value.en;
  for (const key of ["de", "fr", "ja", "es", "zh"] as const) {
    if (typeof value[key] === "string") out[key] = value[key];
  }
  if (out.en.length === 0 && englishFallback.length > 0) out.en = englishFallback;
  return out;
}

/** `{ en: [] }` when the CMS omitted a localized list. */
function asLocalizedList(value: unknown): Localized<string[]> {
  if (Array.isArray(value)) return { en: stringItems(value) };
  const out: Localized<string[]> = { en: [] };
  if (!isRecord(value)) return out;
  for (const key of LOCALE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) out[key] = stringItems(value[key]);
  }
  return out;
}

function asImage(value: unknown): LocalizedImage | undefined {
  if (!isRecord(value) || typeof value.src !== "string" || value.src.length === 0) return undefined;
  return {
    src: value.src,
    width: typeof value.width === "number" ? value.width : 0,
    height: typeof value.height === "number" ? value.height : 0,
    alt: asLocalizedString(value.alt),
    ...(asImageCredit(value.credit) ? { credit: asImageCredit(value.credit) } : {}),
  };
}

/** True when a localized alt (or a legacy plain string) has any non-empty locale. */
function hasAltText(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!isRecord(value)) return false;
  return LOCALE_KEYS.some((key) => typeof value[key] === "string" && value[key].trim().length > 0);
}

function asGalleryImage(value: unknown): GalleryImage | undefined {
  if (!isRecord(value)) return undefined;
  const image = asImage(value.image);
  if (!image) return undefined;
  // Alt is a sibling of `image`. Fall back to alt nested on the image object.
  const alt = hasAltText(value.alt) ? asLocalizedString(value.alt) : image.alt;
  return {
    image: { src: image.src, width: image.width, height: image.height },
    alt,
  };
}

function asGallery(value: unknown): GalleryImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const image = asGalleryImage(item);
    return image ? [image] : [];
  });
}

function asHeroGradient(value: unknown): [string, string] {
  if (!Array.isArray(value)) return HERO_GRADIENT_DEFAULT;
  const from = typeof value[0] === "string" && value[0].trim() ? value[0] : HERO_GRADIENT_DEFAULT[0];
  const to = typeof value[1] === "string" && value[1].trim() ? value[1] : HERO_GRADIENT_DEFAULT[1];
  return [from, to];
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Decap persists a cleared optional number or string as null or "". */
function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function localizedHasText(value: Localized<string>): boolean {
  return LOCALE_KEYS.some((key) => (value[key] ?? "").trim().length > 0);
}

function asSlugList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of source) {
    const slug =
      typeof item === "string"
        ? item.trim()
        : isRecord(item) && typeof item.slug === "string"
          ? item.slug.trim()
          : "";
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/** Finite numbers, in order. Objects `{ price }` from the list widget are unwrapped. */
function asPriceNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const raw = isRecord(item) ? (item.price ?? item.value) : item;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out.push(raw);
      continue;
    }
    if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
      out.push(Number(raw.trim()));
    }
  }
  return out;
}

function asPriceRows(value: unknown): PriceTableRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = asLocalizedString(item.label);
    const prices = asPriceNumbers(item.prices);
    const singleSupplement = asOptionalString(item.singleSupplement) ?? "";
    if (!localizedHasText(label) && prices.length === 0 && !singleSupplement) return [];
    return [{ label, prices, singleSupplement }];
  });
}

function asPriceTable(value: unknown): PriceTable | undefined {
  if (!isRecord(value)) return undefined;
  const caption = asLocalizedString(value.caption);
  const groupSizes = asLocalizedList(value.groupSizes);
  const note = asLocalizedString(value.note);
  const rows = asPriceRows(value.rows);
  const hasSizes = LOCALE_KEYS.some((key) => (groupSizes[key]?.length ?? 0) > 0);
  if (!localizedHasText(caption) && !hasSizes && rows.length === 0 && !localizedHasText(note)) {
    return undefined;
  }
  const rowHeader = PRICE_ROW_HEADERS.find((item) => item === value.rowHeader) ?? "auto";
  return { caption, groupSizes, rows, note, rowHeader };
}

function asHotels(value: unknown): HotelStay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const city = asLocalizedString(item.city);
    const standard = asLocalizedString(item.standard);
    const superior = asLocalizedString(item.superior);
    if (!localizedHasText(city) && !localizedHasText(standard) && !localizedHasText(superior)) {
      return [];
    }
    return [{ city, standard, superior }];
  });
}

function asVehicles(value: unknown): VehicleOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const group = asLocalizedString(item.group);
    const vehicle = asLocalizedString(item.vehicle);
    if (!localizedHasText(group) && !localizedHasText(vehicle)) return [];
    return [{ group, vehicle }];
  });
}

function asItinerary(value: unknown): ItineraryDay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const day =
      typeof item.day === "number" && Number.isFinite(item.day) ? item.day : index + 1;
    const title = asLocalizedString(item.title);
    const description = asLocalizedString(item.description);
    const meals = asLocalizedString(item.meals);
    const image = asGalleryImage(item.image);
    if (!title.en && !description.en && !meals.en && !image) {
      const hasTranslation = (["de", "fr", "ja", "es", "zh"] as const).some(
        (key) =>
          (title[key]?.length ?? 0) > 0 ||
          (description[key]?.length ?? 0) > 0 ||
          (meals[key]?.trim().length ?? 0) > 0,
      );
      if (!hasTranslation) return [];
    }
    return [{ day, title, description, meals, ...(image ? { image } : {}) }];
  });
}

function asDestination(entry: unknown): Destination | undefined {
  if (!isRecord(entry) || typeof entry.slug !== "string" || entry.slug.trim().length === 0) {
    return undefined;
  }
  const slug = entry.slug.trim();
  return {
    slug,
    name: asLocalizedString(entry.name, slug),
    region: asLocalizedString(entry.region),
    summary: asLocalizedString(entry.summary),
    bestSeasons: asLocalizedList(entry.bestSeasons),
    highlights: asLocalizedList(entry.highlights),
    visaNote: asLocalizedString(entry.visaNote),
    intro: asLocalizedString(entry.intro),
    faqs: asFaqs(entry.faqs),
    headings: asHeadings(entry.headings, DESTINATION_HEADING_KEYS),
    heroGradient: asHeroGradient(entry.heroGradient),
    image: asImage(entry.image),
    gallery: asGallery(entry.gallery),
    sample: asBoolean(entry.sample, SAMPLE_DEFAULT),
    published: asBoolean(entry.published, PUBLISHED_DEFAULT),
    seo: asSeo(entry.seo),
  };
}

export function getAllDestinations(): Destination[] {
  return catalogSnapshot<Destination>("destinations", () => readJsonDir("destinations")
    .map(asDestination)
    .filter((entry): entry is Destination => entry !== undefined)
    .sort((a, b) => pick(a.name, "en").localeCompare(pick(b.name, "en"))));
}

/**
 * Published destinations. With a locale, only those that have a page in that locale
 * (every destination in full locales; in zh only those with their own Chinese copy).
 */
export function getDestinations(locale?: string): Destination[] {
  return getAllDestinations()
    .filter((entry) => entry.published)
    .filter((entry) => locale === undefined || destinationAvailableIn(entry, locale));
}

export function getDestination(slug: string): Destination | undefined {
  return getDestinations().find((entry) => entry.slug === slug);
}

/**
 * Partial locales (zh) carry a tour or destination only once its own copy exists. The name /
 * title and summary in that locale are the marker: scripts/zh-translate-next.mjs writes them
 * last, after every other field of the item passed validation.
 */
function ownText(value: Localized<string> | undefined, locale: string): boolean {
  return Boolean(value && isLocalized(value) && (readLocale(value, locale) ?? "").trim().length > 0);
}

export function destinationAvailableIn(destination: Destination, locale: string): boolean {
  if (!isPartialLocale(locale)) return true;
  return ownText(destination.name, locale) && ownText(destination.summary, locale);
}

export function packageAvailableIn(travelPackage: TravelPackage, locale: string): boolean {
  if (!isPartialLocale(locale)) return true;
  return ownText(travelPackage.title, locale) && ownText(travelPackage.summary, locale);
}

const PARTIAL_STATIC_PATHS = new Set([
  "/",
  "/about/",
  "/contact/",
  "/faq/",
  "/how-it-works/",
  "/privacy/",
  "/terms/",
  "/destinations/",
  "/packages/",
]);

/** True when `/<locale><path>` is a real page (used by hreflang, the sitemap and the language switcher). */
export function pathAvailableIn(pathName: string, locale: string): boolean {
  if (!isPartialLocale(locale)) return true;
  const normalized = pathName.startsWith("/") ? pathName : `/${pathName}`;
  const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
  if (PARTIAL_STATIC_PATHS.has(withSlash)) return true;
  const destinationMatch = withSlash.match(/^\/destinations\/([^/]+)\/$/);
  if (destinationMatch) {
    const destination = getDestination(destinationMatch[1]);
    return Boolean(destination && destinationAvailableIn(destination, locale));
  }
  const packageMatch = withSlash.match(/^\/packages\/([^/]+)\/$/);
  if (packageMatch) {
    const travelPackage = getPackages().find((entry) => entry.slug === packageMatch[1]);
    return Boolean(travelPackage && packageAvailableIn(travelPackage, locale));
  }
  return false;
}

/** Locale-agnostic paths that exist in each partial locale. Small; passed to the language switcher. */
export function partialLocalePaths(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const locale of locales) {
    if (!isPartialLocale(locale)) continue;
    out[locale] = [
      ...PARTIAL_STATIC_PATHS,
      ...getDestinations(locale).map((d) => `/destinations/${d.slug}/`),
      ...getPackages(locale).map((p) => `/packages/${p.slug}/`),
    ];
  }
  return out;
}

function asPackage(entry: unknown): TravelPackage | undefined {
  if (!isRecord(entry) || typeof entry.slug !== "string" || entry.slug.trim().length === 0) {
    return undefined;
  }
  const slug = entry.slug.trim();
  const duration = asOptionalNumber(entry.durationDays);
  const durationDays = duration ?? 0;
  return {
    slug,
    title: asLocalizedString(entry.title, slug),
    destination: typeof entry.destination === "string" ? entry.destination.trim() : "",
    countries: asSlugList(entry.countries),
    region: asLocalizedString(entry.region),
    durationDays,
    nights: asOptionalNumber(entry.nights),
    isDayTour: asBoolean(entry.isDayTour, durationDays === 1),
    maxGroupSize: asOptionalNumber(entry.maxGroupSize),
    style: asLocalizedString(entry.style),
    seasonNote: asLocalizedString(entry.seasonNote),
    summary: asLocalizedString(entry.summary),
    intro: asLocalizedString(entry.intro),
    faqs: asFaqs(entry.faqs),
    headings: asHeadings(entry.headings, PACKAGE_HEADING_KEYS),
    itinerary: asItinerary(entry.itinerary),
    included: asLocalizedList(entry.included),
    notIncluded: asLocalizedList(entry.notIncluded),
    priceFrom: asOptionalNumber(entry.priceFrom),
    currency: asOptionalString(entry.currency),
    priceNote: asLocalizedString(entry.priceNote),
    fromLabel: asLocalizedString(entry.fromLabel),
    priceTable: asPriceTable(entry.priceTable),
    hotels: asHotels(entry.hotels),
    vehicles: asVehicles(entry.vehicles),
    changeNote: asLocalizedString(entry.changeNote),
    trainNote: asLocalizedString(entry.trainNote),
    addOns: asSlugList(entry.addOns),
    image: asImage(entry.image),
    gallery: asGallery(entry.gallery),
    sample: asBoolean(entry.sample, SAMPLE_DEFAULT),
    featured: asBoolean(entry.featured, false),
    published: asBoolean(entry.published, PUBLISHED_DEFAULT),
    seo: asSeo(entry.seo),
  };
}

export function getAllPackages(): TravelPackage[] {
  return catalogSnapshot<TravelPackage>("packages", () => readJsonDir("packages")
    .map(asPackage)
    .filter((entry): entry is TravelPackage => entry !== undefined)
    .sort((a, b) => pick(a.title, "en").localeCompare(pick(b.title, "en"))));
}

/** Published packages. With a locale, only those that have a page in that locale. */
export function getPackages(locale?: string): TravelPackage[] {
  return getAllPackages()
    .filter((entry) => entry.published)
    .filter((entry) => locale === undefined || packageAvailableIn(entry, locale));
}

/**
 * Published packages marked `featured: true` for the homepage.
 * Falls back to multi-day packages (or all published packages) if none are marked featured.
 */
export function getFeaturedPackages(locale?: string): TravelPackage[] {
  const all = getPackages(locale);
  const featured = all.filter((entry) => entry.featured);
  if (featured.length > 0) return featured;
  const multiDay = all.filter((entry) => !entry.isDayTour);
  return multiDay.length > 0 ? multiDay : all;
}

function normalizeRegionKey(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const slug = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || trimmed;
}

/**
 * Resolves the geographical region(s) for a package in a given locale.
 * Uses the package's own `region` override when set, or inherits from its linked destinations.
 */
export function getPackageRegions(
  pkg: TravelPackage,
  locale: string,
): { key: string; label: string }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];

  const allDestinations = readJsonDir("destinations")
    .map(asDestination)
    .filter((entry): entry is Destination => entry !== undefined);
  const bySlug = new Map(allDestinations.map((dest) => [dest.slug, dest]));
  const destRegionByKey = new Map<string, Localized<string>>();
  for (const dest of allDestinations) {
    if (!localizedHasText(dest.region)) continue;
    const rawKey = (dest.region.en || pickedString(dest.region, locale)).trim();
    const normKey = normalizeRegionKey(rawKey);
    if (normKey && !destRegionByKey.has(normKey)) {
      destRegionByKey.set(normKey, dest.region);
    }
  }

  const addRegion = (regionField: Localized<string>) => {
    const rawKey = (regionField.en || pickedString(regionField, locale)).trim();
    const key = normalizeRegionKey(rawKey);
    if (!key || seen.has(key)) return;
    let label = isLocale(locale) ? (regionField[locale] ?? "").trim() : "";
    if (!label) {
      const fallbackDestRegion = destRegionByKey.get(key);
      if (fallbackDestRegion) {
        label = pickedString(fallbackDestRegion, locale).trim();
      }
    }
    if (!label) {
      label = pickedString(regionField, locale).trim();
    }
    if (!label) return;
    seen.add(key);
    out.push({ key, label });
  };

  if (localizedHasText(pkg.region)) {
    addRegion(pkg.region);
    return out;
  }

  for (const slug of packageCountries(pkg)) {
    const dest = bySlug.get(slug);
    if (dest && localizedHasText(dest.region)) {
      addRegion(dest.region);
    }
  }
  return out;
}

const PACKAGE_SLUG_ALIASES: Record<string, string> = {
  "uzbekistan-silk-road-10-days": "tashkent-city-chimgan-mountains-5-days",
  "almaty-kolsai-charyn-5-days": "charyn-kolsai-kaindy-2-days",
  "kyrgyzstan-nomad-horsemen-8-days": "ala-archa-burana-tower-day-trip",
  "kyrgyzstan-8-day-nomad-trails": "ala-archa-burana-tower-day-trip",
};

export function resolvePackageSlug(slug: string): string {
  return PACKAGE_SLUG_ALIASES[slug] || slug;
}

export function getPackage(slug: string): TravelPackage | undefined {
  const resolved = resolvePackageSlug(slug);
  return (
    getPackages().find((entry) => entry.slug === slug) ||
    getPackages().find((entry) => entry.slug === resolved)
  );
}

/** Published packages whose primary destination or extra countries include this slug. */
export function getPackagesByDestination(country: string, locale?: string): TravelPackage[] {
  return getPackages(locale).filter((entry) => packageCountries(entry).includes(country));
}

const TITLE_TEMPLATE = "%s | Sunday Atlas Travel";

const STATIC_PAGE_FILES = [
  "home",
  "about",
  "how-it-works",
  "faq",
  "contact",
  "privacy",
  "terms",
  "destinations",
  "packages",
  "blog",
] as const;

export type StaticPageId = (typeof STATIC_PAGE_FILES)[number];

const STATIC_PAGE_PATHS: Record<string, StaticPageId> = {
  "/": "home",
  "/about/": "about",
  "/how-it-works/": "how-it-works",
  "/faq/": "faq",
  "/contact/": "contact",
  "/privacy/": "privacy",
  "/terms/": "terms",
  "/destinations/": "destinations",
  "/packages/": "packages",
  "/blog/": "blog",
};

function emptyLocaleSeo(): LocaleSeo {
  return {
    seoTitle: "",
    metaDescription: "",
    focusKeyword: "",
    keywords: [],
    ogImage: "",
    canonical: "",
    noindex: false,
  };
}

function emptySeo(): SeoByLocale {
  return {
    en: emptyLocaleSeo(),
    de: emptyLocaleSeo(),
    fr: emptyLocaleSeo(),
    ja: emptyLocaleSeo(),
    es: emptyLocaleSeo(),
    zh: emptyLocaleSeo(),
  };
}

/** A keyword list may be plain strings or `{ keyword: "..." }` from the list widget. */
function asKeywordList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (isRecord(item)) {
      const text = item.keyword ?? item.value;
      if (typeof text === "string" && text.trim()) return [text.trim()];
    }
    return [];
  });
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asLocaleSeo(value: unknown): LocaleSeo {
  if (!isRecord(value)) return emptyLocaleSeo();
  return {
    seoTitle: asTrimmedString(value.seo_title),
    metaDescription: asTrimmedString(value.meta_description),
    focusKeyword: asTrimmedString(value.focus_keyword),
    keywords: asKeywordList(value.keywords),
    ogImage: asTrimmedString(value.og_image),
    canonical: asTrimmedString(value.canonical),
    noindex: value.noindex === true,
  };
}

function asSeo(value: unknown): SeoByLocale {
  const seo = emptySeo();
  if (!isRecord(value)) return seo;
  for (const locale of locales) {
    if (Object.prototype.hasOwnProperty.call(value, locale)) {
      seo[locale] = asLocaleSeo(value[locale]);
    }
  }
  return seo;
}

function asFaqs(value: unknown): FaqEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const q = asLocalizedString(item.q);
    const a = asLocalizedString(item.a);
    const hasText = LOCALE_KEYS.some(
      (key) => (q[key]?.length ?? 0) > 0 || (a[key]?.length ?? 0) > 0,
    );
    if (!hasText) return [];
    return [{ q, a }];
  });
}

function asPageSections(value: unknown): PageSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const heading = asLocalizedString(item.heading);
    const body = asLocalizedString(item.body);
    const hasText = LOCALE_KEYS.some(
      (key) => (heading[key] ?? "").trim().length > 0 || (body[key] ?? "").trim().length > 0,
    );
    if (!hasText) return [];
    return [{ heading, body }];
  });
}

function asHeadings<K extends string>(
  value: unknown,
  keys: readonly K[],
): Record<K, Localized<string>> {
  const record = isRecord(value) ? value : {};
  const out = {} as Record<K, Localized<string>>;
  for (const key of keys) {
    out[key] = asLocalizedString(record[key]);
  }
  return out;
}

export type StaticPage = {
  id: StaticPageId;
  title: string;
  seo: SeoByLocale;
  faqs: FaqEntry[];
  /** Locale H2 above the page FAQ. Empty string keeps the dictionary title. */
  faqTitle: Localized<string>;
  /** Optional H2 + text blocks. Missing lists stay empty. */
  sections: PageSection[];
};

function asStaticPage(id: StaticPageId, entry: unknown): StaticPage {
  const record = isRecord(entry) ? entry : {};
  return {
    id,
    title: typeof record.title === "string" ? record.title : id,
    seo: asSeo(record.seo),
    faqs: asFaqs(record.faqs),
    faqTitle: asLocalizedString(record.faq_title),
    sections: asPageSections(record.sections),
  };
}

export function getAllStaticPages(): StaticPage[] {
  return STATIC_PAGE_FILES.map((id) => getStaticPage(id));
}

export function getStaticPage(id: StaticPageId): StaticPage {
  const file = path.join(process.cwd(), "content", "pages", `${id}.json`);
  if (!fs.existsSync(file)) {
    return {
      id,
      title: id,
      seo: emptySeo(),
      faqs: [],
      faqTitle: asLocalizedString(undefined),
      sections: [],
    };
  }
  return asStaticPage(id, JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
}

/** SEO for one locale of a public path. Missing files and fields stay empty. */
export function seoForPath(pathName: string, locale: string): LocaleSeo {
  const safe: Locale = isLocale(locale) ? locale : "en";
  const normalized = pathName.startsWith("/") ? pathName : `/${pathName}`;
  const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
  const staticId = STATIC_PAGE_PATHS[withSlash];
  if (staticId) return getStaticPage(staticId).seo[safe];
  const destinationMatch = withSlash.match(/^\/destinations\/([^/]+)\/$/);
  if (destinationMatch) return getDestination(destinationMatch[1])?.seo[safe] ?? emptyLocaleSeo();
  const packageMatch = withSlash.match(/^\/packages\/([^/]+)\/$/);
  if (packageMatch) return getPackage(packageMatch[1])?.seo[safe] ?? emptyLocaleSeo();
  const blogMatch = withSlash.match(/^\/blog\/([^/]+)\/$/);
  if (blogMatch) return getBlogPost(blogMatch[1])?.seo[safe] ?? emptyLocaleSeo();
  return emptyLocaleSeo();
}

export type AnalyticsProvider = "none" | "ga4" | "cloudflare";

export type SeoSettings = {
  titleTemplate: Record<Locale, string>;
  defaultDescription: Record<Locale, string>;
  defaultKeywords: Record<Locale, string[]>;
  social: {
    x: string;
    instagram: string;
    facebook: string;
    youtube: string;
    tiktok: string;
    linkedin: string;
    trustpilot: string;
  };
  /** Public contact email, or "" when unset. */
  contactEmail: string;
  organizationLogo: string;
  googleSiteVerification: string;
  bingSiteVerification: string;
  analytics: { provider: AnalyticsProvider; id: string };
};

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return trimmed;
}

function asEmail(value: unknown): string {
  const trimmed = asTrimmedString(value);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) ? trimmed : "";
}

/** The public contact email from SEO settings, or "" when unset. */
export function contactEmail(): string {
  return getSeoSettings().contactEmail;
}

function asProvider(value: unknown): AnalyticsProvider {
  if (value === "ga4" || value === "cloudflare" || value === "none") return value;
  return "none";
}

/** Site-wide SEO settings. Missing fields fall back to today's titles and descriptions. */
export function getSeoSettings(): SeoSettings {
  const file = path.join(process.cwd(), "content", "settings", "seo.json");
  const raw = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as unknown) : {};
  const record = isRecord(raw) ? raw : {};
  const templates = isRecord(record.title_template) ? record.title_template : {};
  const descriptions = isRecord(record.default_description) ? record.default_description : {};
  const keywords = isRecord(record.default_keywords) ? record.default_keywords : {};
  const social = isRecord(record.social) ? record.social : {};
  const analytics = isRecord(record.analytics) ? record.analytics : {};

  const titleTemplate = {} as Record<Locale, string>;
  const defaultDescription = {} as Record<Locale, string>;
  const defaultKeywords = {} as Record<Locale, string[]>;
  for (const locale of locales) {
    const template = asTrimmedString(templates[locale]);
    titleTemplate[locale] = template || TITLE_TEMPLATE;
    const description = asTrimmedString(descriptions[locale]);
    defaultDescription[locale] = description || getDictionarySync(locale).meta.defaultDescription;
    defaultKeywords[locale] = asKeywordList(keywords[locale]);
  }

  return {
    titleTemplate,
    defaultDescription,
    defaultKeywords,
    social: {
      x: liveSocialUrl(social.x),
      instagram: liveSocialUrl(social.instagram),
      facebook: liveSocialUrl(social.facebook),
      youtube: liveSocialUrl(social.youtube),
      tiktok: liveSocialUrl(social.tiktok),
      linkedin: liveSocialUrl(social.linkedin),
      trustpilot: liveSocialUrl(social.trustpilot),
    },
    contactEmail: asEmail(record.contact_email),
    organizationLogo: asTrimmedString(record.organization_logo),
    googleSiteVerification: asTrimmedString(record.google_site_verification),
    bingSiteVerification: asTrimmedString(record.bing_site_verification),
    analytics: {
      provider: asProvider(analytics.provider),
      id: asTrimmedString(analytics.id),
    },
  };
}

/** CMS social URL, or "" when it is empty or listed in `pendingSocialUrls` (account not live yet). */
function liveSocialUrl(value: unknown): string {
  const url = httpUrl(value);
  if (!url) return "";
  const norm = (u: string) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  return pendingSocialUrls.some((pending) => norm(pending) === norm(url)) ? "" : url;
}

/** `@handle` from an X or Twitter profile URL, or "" when the URL has no handle. */
export function twitterHandleFromUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return "";
    const handle = parsed.pathname.split("/").filter(Boolean)[0];
    if (!handle) return "";
    return handle.startsWith("@") ? handle : `@${handle}`;
  } catch {
    return "";
  }
}


export type BlogCategory =
  | "top-places"
  | "destination-guide"
  | "day-trips"
  | "seasonal";

const BLOG_CATEGORIES: readonly BlogCategory[] = [
  "top-places",
  "destination-guide",
  "day-trips",
  "seasonal",
];

export type BlogFactRow = {
  label: Localized<string>;
  value: Localized<string>;
};

export type BlogSectionImage = {
  src: string;
  width: number;
  height: number;
  alt: Localized<string>;
  caption: Localized<string>;
  credit?: ImageCredit;
};

export type BlogSection = {
  id: string;
  rankNumber: number | undefined;
  placeName: Localized<string>;
  heading: Localized<string>;
  paragraphs: Localized<string[]>;
  highlights: Localized<string[]>;
  keyFacts: BlogFactRow[];
  image?: BlogSectionImage;
  embeddedPackageSlug: string | undefined;
};

export type BlogPost = {
  slug: string;
  published: boolean;
  featured: boolean;
  category: BlogCategory;
  destination: string;
  countries: string[];
  publishedAt: string;
  updatedAt: string;
  readingTimeMinutes: number;
  title: Localized<string>;
  subtitle: Localized<string>;
  summary: Localized<string>;
  intro: Localized<string>;
  heroImage?: LocalizedImage;
  sections: BlogSection[];
  relatedPackages: string[];
  faqs: FaqEntry[];
  seo: SeoByLocale;
};

function asBlogSectionImage(value: unknown): BlogSectionImage | undefined {
  if (!isRecord(value) || typeof value.src !== "string" || value.src.trim().length === 0) {
    return undefined;
  }
  return {
    src: value.src.trim(),
    width: typeof value.width === "number" ? value.width : 1600,
    height: typeof value.height === "number" ? value.height : 1067,
    alt: asLocalizedString(value.alt),
    caption: asLocalizedString(value.caption),
    ...(asImageCredit(value.credit) ? { credit: asImageCredit(value.credit) } : {}),
  };
}

function asBlogFacts(value: unknown): BlogFactRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = asLocalizedString(item.label);
    const val = asLocalizedString(item.value);
    if (!localizedHasText(label) && !localizedHasText(val)) return [];
    return [{ label, value: val }];
  });
}

function asBlogSections(value: unknown): BlogSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : `section-${index + 1}`;
    const rankNumber = asOptionalNumber(item.rankNumber);
    const placeName = asLocalizedString(item.placeName);
    const heading = asLocalizedString(item.heading);
    const paragraphs = asLocalizedList(item.paragraphs);
    const highlights = asLocalizedList(item.highlights);
    const keyFacts = asBlogFacts(item.keyFacts);
    const image = asBlogSectionImage(item.image);
    const rawPkg = asOptionalString(item.embeddedPackageSlug);
    const embeddedPackageSlug = rawPkg ? resolvePackageSlug(rawPkg) : undefined;
    return [
      {
        id,
        rankNumber,
        placeName,
        heading,
        paragraphs,
        highlights,
        keyFacts,
        ...(image ? { image } : {}),
        embeddedPackageSlug,
      },
    ];
  });
}

function asBlogPost(entry: unknown): BlogPost | undefined {
  if (!isRecord(entry) || typeof entry.slug !== "string" || entry.slug.trim().length === 0) {
    return undefined;
  }
  const slug = entry.slug.trim();
  const catRaw = typeof entry.category === "string" ? entry.category.trim() : "";
  const category: BlogCategory =
    BLOG_CATEGORIES.find((c) => c === catRaw) ?? "destination-guide";
  const publishedAt =
    typeof entry.publishedAt === "string" && entry.publishedAt.trim()
      ? entry.publishedAt.trim()
      : "2026-10-27";
  const updatedAt =
    typeof entry.updatedAt === "string" && entry.updatedAt.trim()
      ? entry.updatedAt.trim()
      : publishedAt;
  const readingTimeMinutes = asOptionalNumber(entry.readingTimeMinutes) ?? 8;
  const rawRelated = asSlugList(entry.relatedPackages);
  const relatedPackages = Array.from(new Set(rawRelated.map(resolvePackageSlug)));

  return {
    slug,
    published: asBoolean(entry.published, PUBLISHED_DEFAULT),
    featured: asBoolean(entry.featured, false),
    category,
    destination: typeof entry.destination === "string" ? entry.destination.trim() : "",
    countries: asSlugList(entry.countries),
    publishedAt,
    updatedAt,
    readingTimeMinutes,
    title: asLocalizedString(entry.title, slug),
    subtitle: asLocalizedString(entry.subtitle),
    summary: asLocalizedString(entry.summary),
    intro: asLocalizedString(entry.intro),
    heroImage: asImage(entry.heroImage),
    sections: asBlogSections(entry.sections),
    relatedPackages,
    faqs: asFaqs(entry.faqs),
    seo: asSeo(entry.seo),
  };
}

export function blogCountries(post: {
  destination?: string;
  countries?: readonly string[];
}): string[] {
  return packageCountries(post);
}

export function getAllBlogPosts(): BlogPost[] {
  return catalogSnapshot<BlogPost>("blog", () => readJsonDir("blog")
    .map(asBlogPost)
    .filter((entry): entry is BlogPost => entry !== undefined)
    .sort((a, b) => {
      if (a.featured !== b.featured) return b.featured ? 1 : -1;
      const dateCmp = b.publishedAt.localeCompare(a.publishedAt);
      if (dateCmp !== 0) return dateCmp;
      return pick(a.title, "en").localeCompare(pick(b.title, "en"));
    }));
}

/** Published posts. With a locale that has no blog (zh), none. */
export function getBlogPosts(locale?: string): BlogPost[] {
  if (locale !== undefined && !hasBlog(locale)) return [];
  return getAllBlogPosts().filter((entry) => entry.published);
}

export function getFeaturedBlogPosts(limit = 4, locale?: string): BlogPost[] {
  const all = getBlogPosts(locale);
  const featured = all.filter((entry) => entry.featured);
  const rest = all.filter((entry) => !entry.featured);
  return [...featured, ...rest].slice(0, limit);
}

export function getBlogPost(slug: string): BlogPost | undefined {
  return getBlogPosts().find((entry) => entry.slug === slug);
}

export function getBlogPostsByDestination(country: string, locale?: string): BlogPost[] {
  return getBlogPosts(locale).filter((entry) => blogCountries(entry).includes(country));
}

export function getBlogPostsForPackage(packageSlug: string, locale?: string): BlogPost[] {
  const resolvedTarget = resolvePackageSlug(packageSlug);
  return getBlogPosts(locale).filter((post) => {
    const inRelated = post.relatedPackages.some(
      (s) => s === packageSlug || resolvePackageSlug(s) === resolvedTarget,
    );
    const inSections = post.sections.some(
      (sec) =>
        sec.embeddedPackageSlug === packageSlug ||
        (sec.embeddedPackageSlug &&
          resolvePackageSlug(sec.embeddedPackageSlug) === resolvedTarget),
    );
    return inRelated || inSections;
  });
}

export function localizeBlogPost(post: BlogPost, locale: string) {
  const title = pickedString(post.title, locale);
  return {
    slug: post.slug,
    published: post.published,
    featured: post.featured,
    category: post.category,
    destination: post.destination,
    countries: blogCountries(post),
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    readingTimeMinutes: post.readingTimeMinutes,
    title,
    subtitle: pickedString(post.subtitle, locale).trim(),
    summary: pickedString(post.summary, locale),
    intro: pickedString(post.intro, locale),
    heroImage: post.heroImage,
    sections: post.sections.map((sec) => ({
      id: sec.id,
      rankNumber: sec.rankNumber,
      placeName: pickedString(sec.placeName, locale).trim(),
      heading: pickedString(sec.heading, locale),
      paragraphs: pickedList(sec.paragraphs, locale),
      highlights: pickedList(sec.highlights, locale),
      keyFacts: sec.keyFacts.map((row) => ({
        label: pickedString(row.label, locale).trim(),
        value: pickedString(row.value, locale).trim(),
      })),
      image: sec.image
        ? {
            src: sec.image.src,
            width: sec.image.width,
            height: sec.image.height,
            alt: imageAlt(sec.image, locale) || pickedString(sec.heading, locale),
            caption: pickedString(sec.image.caption, locale).trim(),
            credit: sec.image.credit,
          }
        : undefined,
      embeddedPackageSlug: sec.embeddedPackageSlug,
    })),
    relatedPackages: post.relatedPackages,
    faqs: localizeFaqs(post.faqs, locale),
    seo: post.seo,
  };
}
