import { heroImage } from "@/config/images";
import { siteName, siteShortName } from "@/config/site";
import { isLocale, localeTags, locales, type Locale } from "@/i18n/config";
import { getDictionarySync } from "@/i18n/getDictionary";
import {
  contactEmail,
  getSeoSettings,
  getDestination,
  getDestinations,
  getPackage,
  getPackages,
  localizeBlogPost,
  localizeDestination,
  localizePackage,
  type BlogPost,
  type Destination,
  type GalleryImage,
  type TravelPackage,
} from "@/lib/content";
import { cldCrop, SCHEMA_IMAGE_CROPS } from "@/lib/cloudinary";
import { isoDateTime, lastModified } from "@/lib/dates";
import { absoluteAssetUrl, absoluteUrl, siteOrigin } from "@/lib/metadata";

export type JsonLdObject = Record<string, unknown>;

export type FaqItem = { q: string; a: string };

export type BreadcrumbItem = { name: string; url: string };

const ORGANIZATION_ID = `${siteOrigin()}/#organization`;

/** Square 512x512 PNG rendered from public/favicon.svg. */
const LOGO_PATH = "/logo.png";

/** Registered office. No telephone, geo, or opening hours are published. */
const ORGANIZATION_ADDRESS = {
  "@type": "PostalAddress",
  streetAddress: "Theerawan Palace, No 410",
  addressLocality: "Bangkok",
  addressCountry: "TH",
} as const;

/**
 * Lowest and highest per-person USD price across every published tour: the lowest "from" price and
 * the highest price-table cell (usually one traveller). Read from the catalog, so it follows price edits.
 */
function organizationPriceRange(): string | undefined {
  const prices: number[] = [];
  for (const pkg of getPackages()) {
    if (pkg.currency && pkg.currency !== "USD") continue;
    if (typeof pkg.priceFrom === "number" && pkg.priceFrom > 0) prices.push(pkg.priceFrom);
    for (const row of pkg.priceTable?.rows ?? []) {
      for (const value of row.prices) if (typeof value === "number" && value > 0) prices.push(value);
    }
  }
  if (prices.length === 0) return undefined;
  return `$${Math.min(...prices)}-$${Math.max(...prices)}`;
}

/**
 * What the agency plans trips for, from the catalog: each published region ("Central Asia travel"),
 * each country as a schema.org Country, and the two tour formats that exist (multi-day, day tours).
 */
function organizationKnowsAbout(): (string | JsonLdObject)[] {
  const destinations = getDestinations();
  const regions = Array.from(
    new Set(destinations.map((d) => localizeDestination(d, "en").region).filter((r) => r.length > 0)),
  );
  const packages = getPackages();
  const formats = [
    ...(packages.some((p) => !p.isDayTour) ? ["Private multi-day tours"] : []),
    ...(packages.some((p) => p.isDayTour) ? ["Private day tours"] : []),
  ];
  return [
    ...regions.map((region) => `${region} travel`),
    ...formats,
    ...destinations.flatMap((d) => {
      const name = localizeDestination(d, "en").name;
      return name ? [{ "@type": "Country", name }] : [];
    }),
  ];
}

/** Countries the published destinations cover (English names), as schema.org Country objects. */
function organizationAreaServed(): JsonLdObject[] {
  return getDestinations().flatMap((destination) => {
    const name = localizeDestination(destination, "en").name;
    return name ? [{ "@type": "Country", name }] : [];
  });
}

/** Every site language as a BCP 47 tag (zh is "zh-Hans"), so a new locale is listed automatically. */
const CONTACT_LANGUAGES = locales.map((l) => localeTags[l]);

/** Main photo first, then each gallery frame. Absolute URLs. No rating or review data. */
function schemaImages(mainSrc: string | undefined, gallery: GalleryImage[] | undefined): string[] {
  const urls: string[] = [];
  const hero = mainSrc?.trim();
  if (hero) urls.push(absoluteAssetUrl(hero));
  for (const item of gallery ?? []) {
    const src = item?.image?.src?.trim();
    if (src) urls.push(absoluteAssetUrl(src));
  }
  return urls;
}

/**
 * TravelAgency for the current locale: logo, Bangkok postal address, price range from the catalog,
 * areaServed (the countries of the published destinations), and a customer-service ContactPoint with the email from SEO settings.
 * No telephone, geo, opening hours, or rating.
 */
export function travelAgencySchema(locale: string): JsonLdObject {
  const safe: Locale = isLocale(locale) ? locale : "en";
  const dict = getDictionarySync(safe);
  const settings = getSeoSettings();
  const origin = siteOrigin();
  const heroUrl = absoluteAssetUrl(heroImage.src);
  const logo = settings.organizationLogo
    ? absoluteAssetUrl(settings.organizationLogo)
    : `${origin}${LOGO_PATH}`;
  const sameAs = Object.values(settings.social).filter((url) => url.length > 0);
  const email = contactEmail();
  const priceRange = organizationPriceRange();
  const areaServed = organizationAreaServed();
  const knowsAbout = organizationKnowsAbout();
  return {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    "@id": ORGANIZATION_ID,
    name: siteName,
    alternateName: siteShortName,
    url: `${origin}/${safe}/`,
    logo,
    image: heroUrl,
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(email ? { email } : {}),
    address: ORGANIZATION_ADDRESS,
    ...(priceRange ? { priceRange } : {}),
    ...(areaServed.length > 0 ? { areaServed } : {}),
    ...(knowsAbout.length > 0 ? { knowsAbout } : {}),
    knowsLanguage: [...CONTACT_LANGUAGES],
    ...(email
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer service",
            email,
            availableLanguage: [...CONTACT_LANGUAGES],
          },
        }
      : {}),
    inLanguage: localeTags[safe],
    description: dict.home.meta.description,
  };
}

/** FAQPage from the same question/answer pairs the FAQ page renders. */
export function faqPageSchema(items: readonly FaqItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

/** BreadcrumbList. `url` values must already be absolute. Names follow the page locale. */
export function breadcrumbSchema(items: readonly BreadcrumbItem[], locale: string): JsonLdObject {
  const language: Locale = isLocale(locale) ? locale : "en";
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    inLanguage: localeTags[language],
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** 1:1, 4:3 and 16:9 Cloudinary crops of the package main photo, or [] when it is not a Cloudinary upload. */
function packageImageCrops(pkg: TravelPackage): { url: string; width: number; height: number }[] {
  const src = pkg.image?.src?.trim();
  if (!src) return [];
  return SCHEMA_IMAGE_CROPS.flatMap(({ width, height }) => {
    const url = cldCrop(src, width, height);
    return url ? [{ url, width, height }] : [];
  });
}

/**
 * WebPage for one package page. `primaryImageOfPage` is the 16:9 crop of the
 * main photo when it is a Cloudinary upload, else the main photo itself.
 */
export function packageWebPageSchema(pkg: TravelPackage, locale: string): JsonLdObject {
  const language: Locale = isLocale(locale) ? locale : "en";
  const copy = localizePackage(pkg, language);
  const pageUrl = absoluteUrl(language, `/packages/${pkg.slug}/`);
  const wide = packageImageCrops(pkg).find((crop) => crop.width === 1920 && crop.height === 1080);
  const mainSrc = pkg.image?.src?.trim();
  const schema: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: copy.title,
    inLanguage: localeTags[language],
    isPartOf: { "@id": `${siteOrigin()}/#website` },
    about: { "@id": ORGANIZATION_ID },
  };
  if (copy.summary) schema.description = copy.summary;
  if (wide) {
    schema.primaryImageOfPage = { "@type": "ImageObject", url: wide.url, width: wide.width, height: wide.height };
  } else if (mainSrc) {
    schema.primaryImageOfPage = { "@type": "ImageObject", url: absoluteAssetUrl(mainSrc) };
  }
  return schema;
}

/**
 * TouristTrip for one package. Name, description, touristType, and itinerary
 * follow the page locale. `url` follows the page locale.
 * `provider` is the site TravelAgency. When a priceTable has multiple numeric
 * tiers, `AggregateOffer` is emitted with `lowPrice` and `highPrice`; otherwise
 * a single `Offer` is included when both priceFrom and currency are set.
 * Typed as TouristTrip and Product, with the site as Brand. Availability,
 * shipping, returns, rating and review are omitted.
 */
export function touristTripSchema(
  pkg: TravelPackage,
  destination: Destination | undefined,
  locale: string,
): JsonLdObject {
  const language: Locale = isLocale(locale) ? locale : "en";
  const copy = localizePackage(pkg, language);
  const place = destination ? localizeDestination(destination, language) : undefined;
  const pageUrl = absoluteUrl(language, `/packages/${pkg.slug}/`);
  const schema: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": ["TouristTrip", "Product"],
    name: copy.title,
    url: pageUrl,
    inLanguage: localeTags[language],
    provider: { "@id": ORGANIZATION_ID },
    brand: { "@type": "Brand", name: siteName },
  };
  if (copy.summary) schema.description = copy.summary;
  if (copy.style) schema.touristType = copy.style;
  if (copy.itinerary.length > 0) {
    schema.itinerary = {
      "@type": "ItemList",
      ...(place?.name ? { name: place.name } : {}),
      itemListElement: copy.itinerary.map((day) => ({
        "@type": "ListItem",
        position: day.day,
        ...(day.title ? { name: day.title } : {}),
        ...(day.description ? { description: day.description } : {}),
      })),
    };
  }

  const crops = packageImageCrops(pkg).map((crop) => crop.url);
  const images = [...crops, ...schemaImages(pkg.image?.src, pkg.gallery)];
  if (images.length > 0) schema.image = images;

  if (pkg.currency != null) {
    const tablePrices = (copy.priceTable?.rows ?? []).flatMap((row) =>
      row.prices.filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0),
    );
    const allPrices = [
      ...(pkg.priceFrom != null && Number.isFinite(pkg.priceFrom) && pkg.priceFrom > 0 ? [pkg.priceFrom] : []),
      ...tablePrices,
    ];
    if (tablePrices.length > 1 && allPrices.length > 0) {
      const lowPrice = Math.min(...allPrices);
      const highPrice = Math.max(...allPrices);
      schema.offers = {
        "@type": "AggregateOffer",
        lowPrice: String(lowPrice),
        highPrice: String(highPrice),
        offerCount: tablePrices.length,
        priceCurrency: pkg.currency,
        availability: "https://schema.org/InStock",
        priceValidUntil: "2027-12-31",
        url: pageUrl,
        ...(copy.fromLabel ? { description: copy.fromLabel } : {}),
      };
    } else if (typeof pkg.priceFrom === "number" && pkg.priceFrom > 0) {
      schema.offers = {
        "@type": "Offer",
        price: String(pkg.priceFrom),
        priceCurrency: pkg.currency,
        availability: "https://schema.org/InStock",
        priceValidUntil: "2027-12-31",
        url: pageUrl,
        ...(copy.fromLabel ? { description: copy.fromLabel } : {}),
      };
    }
  }

  return schema;
}

/**
 * ItemList for the `/packages/` catalog page so search engines see an ordered
 * structured list of every published tour package.
 */
export function packageListSchema(packages: readonly TravelPackage[], locale: string): JsonLdObject {
  const language: Locale = isLocale(locale) ? locale : "en";
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    inLanguage: localeTags[language],
    numberOfItems: packages.length,
    itemListElement: packages.map((pkg, index) => {
      const copy = localizePackage(pkg, language);
      const pkgUrl = absoluteUrl(language, `/packages/${pkg.slug}/`);
      return {
        "@type": "ListItem",
        position: index + 1,
        name: copy.title,
        url: pkgUrl,
        ...(typeof pkg.priceFrom === "number" && pkg.priceFrom > 0 && pkg.currency
          ? {
              item: {
                "@type": ["TouristTrip", "Product"],
                name: copy.title,
                url: pkgUrl,
                ...(pkg.image?.src ? { image: absoluteAssetUrl(pkg.image.src) } : {}),
                offers: {
                  "@type": "Offer",
                  price: String(pkg.priceFrom),
                  priceCurrency: pkg.currency,
                  availability: "https://schema.org/InStock",
                  priceValidUntil: "2027-12-31",
                  url: pkgUrl,
                },
              },
            }
          : {}),
      };
    }),
  };
}

/**
 * ItemList for the `/destinations/` directory page so search engines see an
 * ordered structured list of every published destination country.
 */
export function destinationListSchema(destinations: readonly Destination[], locale: string): JsonLdObject {
  const language: Locale = isLocale(locale) ? locale : "en";
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    inLanguage: localeTags[language],
    itemListElement: destinations.map((destination, index) => {
      const copy = localizeDestination(destination, language);
      return {
        "@type": "ListItem",
        position: index + 1,
        name: copy.name,
        url: absoluteUrl(language, `/destinations/${destination.slug}/`),
      };
    }),
  };
}

/**
 * TouristDestination for one destination page. Name and description follow the
 * page locale. No rating or review fields.
 */
export function touristDestinationSchema(destination: Destination, locale: string): JsonLdObject {
  const language: Locale = isLocale(locale) ? locale : "en";
  const copy = localizeDestination(destination, language);
  const schema: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "TouristDestination",
    name: copy.name,
    url: absoluteUrl(locale, `/destinations/${destination.slug}/`),
    inLanguage: localeTags[language],
  };
  if (copy.summary) schema.description = copy.summary;
  const images = schemaImages(destination.image?.src, destination.gallery);
  if (images.length > 0) schema.image = images;
  return schema;
}

/**
 * ItemList of published tour packages for a specific destination page,
 * including live USD Product offers to maximize SERP rich result height.
 */
export function destinationPackagesSchema(
  destination: Destination,
  packages: readonly TravelPackage[],
  locale: string,
): JsonLdObject {
  const language: Locale = isLocale(locale) ? locale : "en";
  const destCopy = localizeDestination(destination, language);
  const pageUrl = absoluteUrl(language, `/destinations/${destination.slug}/`);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${pageUrl}#tours`,
    name: `${destCopy.name} Tours & Day Trips`,
    inLanguage: localeTags[language],
    numberOfItems: packages.length,
    itemListElement: packages.map((pkg, index) => {
      const copy = localizePackage(pkg, language);
      const pkgUrl = absoluteUrl(language, `/packages/${pkg.slug}/`);
      return {
        "@type": "ListItem",
        position: index + 1,
        name: copy.title,
        url: pkgUrl,
        item: {
          "@type": ["TouristTrip", "Product"],
          name: copy.title,
          description: copy.summary,
          url: pkgUrl,
          provider: { "@id": ORGANIZATION_ID },
          ...(pkg.image?.src ? { image: absoluteAssetUrl(pkg.image.src) } : {}),
          ...(typeof pkg.priceFrom === "number" && pkg.priceFrom > 0 && pkg.currency
            ? {
                offers: {
                  "@type": "Offer",
                  price: String(pkg.priceFrom),
                  priceCurrency: pkg.currency,
                  availability: "https://schema.org/InStock",
                  priceValidUntil: "2027-12-31",
                  url: pkgUrl,
                },
              }
            : {}),
        },
      };
    }),
  };
}

/**
 * WebPage schema for the locale homepage with `primaryImageOfPage` ImageObject.
 */
/** WebSite node for the home page. One canonical URL for every locale. */
export function websiteSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteOrigin()}/#website`,
    name: siteName,
    alternateName: siteShortName,
    url: `${siteOrigin()}/`,
    publisher: { "@id": ORGANIZATION_ID },
  };
}

export function homeWebPageSchema(locale: string): JsonLdObject {
  const safe: Locale = isLocale(locale) ? locale : "en";
  const dict = getDictionarySync(safe);
  const pageUrl = absoluteUrl(safe, "/");
  const heroUrl = absoluteAssetUrl(heroImage.src);
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: `${dict.home.meta.title} | ${siteName}`,
    description: dict.home.meta.description,
    inLanguage: localeTags[safe],
    about: { "@id": ORGANIZATION_ID },
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: heroUrl,
      width: heroImage.width,
      height: heroImage.height,
      caption: dict.home.heroImageAlt,
    },
  };
}


/** 1:1, 4:3 and 16:9 Cloudinary crops of a blog hero image. */
function blogImageCrops(src: string | undefined): { url: string; width: number; height: number }[] {
  const trimmed = src?.trim();
  if (!trimmed) return [];
  return SCHEMA_IMAGE_CROPS.flatMap(({ width, height }) => {
    const url = cldCrop(trimmed, width, height);
    return url ? [{ url, width, height }] : [];
  });
}

/**
 * ItemList for the `/blog/` index page so search engines see an ordered
 * structured list of every published travel guide.
 */
export function blogListSchema(posts: readonly BlogPost[], locale: string): JsonLdObject {
  const language: Locale = isLocale(locale) ? locale : "en";
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    inLanguage: localeTags[language],
    itemListElement: posts.map((post, index) => {
      const copy = localizeBlogPost(post, language);
      return {
        "@type": "ListItem",
        position: index + 1,
        name: copy.title,
        url: absoluteUrl(language, `/blog/${post.slug}/`),
      };
    }),
  };
}

/**
 * BlogPosting + Article JSON-LD for one travel guide, including 1:1, 4:3, and 16:9
 * image crops, `about` Destination link, `mentions` TouristTrip links to every
 * related tour package, and an `ItemList` when the article has ranked Top Places sections.
 */
export function blogPostingSchema(post: BlogPost, locale: string): JsonLdObject[] {
  const language: Locale = isLocale(locale) ? locale : "en";
  const copy = localizeBlogPost(post, language);
  const pageUrl = absoluteUrl(language, `/blog/${post.slug}/`);
  const dest = getDestination(post.destination);
  const destCopy = dest ? localizeDestination(dest, language) : undefined;
  const crops = blogImageCrops(post.heroImage?.src).map((c) => c.url);
  const sectionImages = copy.sections.flatMap((s) =>
    s.image?.src ? [absoluteAssetUrl(s.image.src)] : [],
  );
  const allImages = Array.from(
    new Set([
      ...crops,
      ...(post.heroImage?.src ? [absoluteAssetUrl(post.heroImage.src)] : []),
      ...sectionImages,
    ]),
  );

  const relatedPkgs = copy.relatedPackages.flatMap((slug) => {
    const p = getPackage(slug);
    return p ? [p] : [];
  });

  const seoEntry = post.seo[language] || post.seo.en;
  const keywords = seoEntry?.keywords?.length
    ? seoEntry.keywords
    : seoEntry?.focusKeyword
      ? [seoEntry.focusKeyword]
      : [];

  const article: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": ["BlogPosting", "Article"],
    "@id": `${pageUrl}#article`,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
    },
    headline: copy.title,
    name: copy.title,
    description: copy.summary,
    url: pageUrl,
    inLanguage: localeTags[language],
    datePublished: isoDateTime(copy.publishedAt),
    dateModified: lastModified(copy.publishedAt, copy.updatedAt),
    author: { "@id": ORGANIZATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
    isPartOf: { "@id": `${siteOrigin()}/#website` },
    ...(allImages.length > 0 ? { image: allImages } : {}),
    ...(keywords.length > 0 ? { keywords: keywords.join(", ") } : {}),
    ...(destCopy
      ? {
          about: {
            "@type": "TouristDestination",
            name: destCopy.name,
            url: absoluteUrl(language, `/destinations/${dest!.slug}/`),
          },
        }
      : {}),
    ...(relatedPkgs.length > 0
      ? {
          mentions: relatedPkgs.map((pkg) => {
            const pkgCopy = localizePackage(pkg, language);
            const pkgUrl = absoluteUrl(language, `/packages/${pkg.slug}/`);
            return {
              "@type": "TouristTrip",
              name: pkgCopy.title,
              description: pkgCopy.summary,
              url: pkgUrl,
              provider: { "@id": ORGANIZATION_ID },
              ...(typeof pkg.priceFrom === "number" && pkg.priceFrom > 0 && pkg.currency
                ? {
                    offers: {
                      "@type": "Offer",
                      price: String(pkg.priceFrom),
                      priceCurrency: pkg.currency,
                      availability: "https://schema.org/InStock",
                      priceValidUntil: "2027-12-31",
                      url: pkgUrl,
                    },
                  }
                : {}),
            };
          }),
        }
      : {}),
  };

  const rankedSections = copy.sections.filter(
    (s): s is typeof s & { rankNumber: number } => typeof s.rankNumber === "number",
  );

  if (rankedSections.length > 0) {
    const itemList: JsonLdObject = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "@id": `${pageUrl}#top-places`,
      name: copy.title,
      description: copy.summary,
      inLanguage: localeTags[language],
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      numberOfItems: rankedSections.length,
      itemListElement: rankedSections.map((sec) => ({
        "@type": "ListItem",
        position: sec.rankNumber,
        name: sec.placeName || sec.heading,
        url: `${pageUrl}#${sec.id}`,
        ...(sec.paragraphs[0] ? { description: sec.paragraphs[0] } : {}),
        ...(sec.image?.src ? { image: absoluteAssetUrl(sec.image.src) } : {}),
      })),
    };
    return [article, itemList];
  }

  return [article];
}
