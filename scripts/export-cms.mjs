import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toSanityBlogPost } from "./lib/sanity-blog.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(rootDir, "content");
const exportsDir = join(rootDir, "exports");
const publicExportsDir = join(rootDir, "public", "exports");

const LOCALES = ["en", "de", "fr", "ja", "es"];
const SITE_ORIGIN = "https://sundayatlastravel.com";

function readJsonFolder(subpath) {
  const dir = join(contentDir, subpath);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((file) => {
    const id = basename(file, ".json");
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    return { id, file, data };
  });
}

function withKeys(items, prefix) {
  if (!Array.isArray(items)) return [];
  return items.map((item, idx) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return {
        _key: item._key || `${prefix}-${idx + 1}`,
        ...item,
      };
    }
    return item;
  });
}

function normalizePriceTable(priceTable) {
  if (!priceTable || typeof priceTable !== "object") return undefined;
  const rows = Array.isArray(priceTable.rows)
    ? priceTable.rows.map((row, idx) => {
        const rawSupp = row?.singleSupplement;
        const singleSupplement =
          typeof rawSupp === "string"
            ? rawSupp
            : rawSupp && typeof rawSupp === "object" && typeof rawSupp.en === "string"
              ? rawSupp.en
              : "";
        return {
          _key: row?._key || `row-${idx + 1}`,
          label: row?.label ?? { en: "" },
          prices: Array.isArray(row?.prices) ? row.prices : [],
          singleSupplement,
        };
      })
    : [];
  return {
    ...priceTable,
    rows,
  };
}

function toSanityDestination({ id, data }) {
  const slug = data.slug || id;
  return {
    _id: `destination-${slug}`,
    _type: "destination",
    slug,
    name: data.name ?? { en: slug },
    region: data.region ?? { en: "" },
    summary: data.summary ?? { en: "" },
    intro: data.intro ?? { en: "" },
    bestSeasons: data.bestSeasons ?? { en: [] },
    highlights: data.highlights ?? { en: [] },
    visaNote: data.visaNote ?? { en: "" },
    heroGradient: Array.isArray(data.heroGradient) ? data.heroGradient : ["#0E4F57", "#1C2430"],
    ...(data.image ? { image: data.image } : {}),
    gallery: withKeys(data.gallery, "gallery"),
    faqs: withKeys(data.faqs, "faq"),
    headings: data.headings ?? {},
    sample: Boolean(data.sample),
    published: Boolean(data.published),
    seo: data.seo ?? {},
  };
}

function toSanityPackage({ id, data }) {
  const slug = data.slug || id;
  const durationDays = typeof data.durationDays === "number" ? data.durationDays : 1;
  return {
    _id: `travelPackage-${slug}`,
    _type: "travelPackage",
    slug,
    title: data.title ?? { en: slug },
    destination: data.destination ?? "",
    countries: Array.isArray(data.countries) ? data.countries : [],
    ...(data.region ? { region: data.region } : {}),
    durationDays,
    ...(typeof data.nights === "number" ? { nights: data.nights } : {}),
    isDayTour: typeof data.isDayTour === "boolean" ? data.isDayTour : durationDays === 1,
    ...(typeof data.maxGroupSize === "number" ? { maxGroupSize: data.maxGroupSize } : {}),
    style: data.style ?? { en: "" },
    seasonNote: data.seasonNote ?? { en: "" },
    summary: data.summary ?? { en: "" },
    intro: data.intro ?? { en: "" },
    itinerary: withKeys(data.itinerary, "day"),
    included: data.included ?? { en: [] },
    notIncluded: data.notIncluded ?? { en: [] },
    ...(typeof data.priceFrom === "number" ? { priceFrom: data.priceFrom } : {}),
    ...(typeof data.currency === "string" ? { currency: data.currency } : {}),
    priceNote: data.priceNote ?? { en: "" },
    fromLabel: data.fromLabel ?? { en: "" },
    ...(data.priceTable ? { priceTable: normalizePriceTable(data.priceTable) } : {}),
    hotels: withKeys(data.hotels, "hotel"),
    vehicles: withKeys(data.vehicles, "vehicle"),
    ...(data.changeNote ? { changeNote: data.changeNote } : {}),
    ...(data.trainNote ? { trainNote: data.trainNote } : {}),
    addOns: Array.isArray(data.addOns) ? data.addOns : [],
    ...(data.image ? { image: data.image } : {}),
    gallery: withKeys(data.gallery, "gallery"),
    faqs: withKeys(data.faqs, "faq"),
    headings: data.headings ?? {},
    sample: Boolean(data.sample),
    featured: Boolean(data.featured),
    published: Boolean(data.published),
    seo: data.seo ?? {},
  };
}


function toSanityStaticPage({ id, data }) {
  return {
    _id: `staticPage-${id}`,
    _type: "staticPage",
    pageId: id,
    title: data.title ?? id,
    ...(data.faq_title ? { faq_title: data.faq_title } : {}),
    faqs: withKeys(data.faqs, "faq"),
    sections: withKeys(data.sections, "section"),
    seo: data.seo ?? {},
  };
}

function toSanitySettings(settingsEntries) {
  const seoEntry = settingsEntries.find((s) => s.id === "seo")?.data ?? {};
  const turnstileEntry = settingsEntries.find((s) => s.id === "turnstile")?.data ?? {};
  return [
    {
      _id: "siteSettings-seo",
      _type: "siteSettings",
      settingKey: "seo",
      title_template: seoEntry.title_template ?? {},
      default_description: seoEntry.default_description ?? {},
      default_keywords: seoEntry.default_keywords ?? {},
      social: seoEntry.social ?? {},
      contact_email: seoEntry.contact_email ?? "",
      organization_logo: seoEntry.organization_logo ?? "",
      google_site_verification: seoEntry.google_site_verification ?? "",
      bing_site_verification: seoEntry.bing_site_verification ?? "",
      analytics: seoEntry.analytics ?? { provider: "none", id: "" },
      turnstile_site_key: turnstileEntry.site_key ?? "",
    },
  ];
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildPackagesCsv(packages) {
  const headers = [
    "slug",
    "title_en",
    "title_de",
    "title_fr",
    "title_ja",
    "title_es",
    "destination",
    "countries",
    "durationDays",
    "nights",
    "isDayTour",
    "maxGroupSize",
    "priceFrom",
    "currency",
    "fromLabel_en",
    "style_en",
    "seasonNote_en",
    "summary_en",
    "featured",
    "published",
    "sample",
    "heroImageUrl",
    "galleryCount",
    "itineraryDaysCount",
    "liveUrl_en",
    "liveUrl_de",
    "liveUrl_fr",
    "liveUrl_ja",
    "liveUrl_es",
  ];

  const rows = [headers.join(",")];

  for (const pkg of packages) {
    const slug = pkg.slug;
    const allCountries = [pkg.destination, ...(pkg.countries || [])]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(";");

    const values = [
      slug,
      pkg.title?.en ?? "",
      pkg.title?.de ?? "",
      pkg.title?.fr ?? "",
      pkg.title?.ja ?? "",
      pkg.title?.es ?? "",
      pkg.destination ?? "",
      allCountries,
      pkg.durationDays ?? "",
      pkg.nights ?? "",
      pkg.isDayTour ? "true" : "false",
      pkg.maxGroupSize ?? "",
      pkg.priceFrom ?? "",
      pkg.currency ?? "",
      pkg.fromLabel?.en ?? "",
      pkg.style?.en ?? "",
      pkg.seasonNote?.en ?? "",
      pkg.summary?.en ?? "",
      pkg.featured ? "true" : "false",
      pkg.published ? "true" : "false",
      pkg.sample ? "true" : "false",
      pkg.image?.src ?? "",
      Array.isArray(pkg.gallery) ? pkg.gallery.length : 0,
      Array.isArray(pkg.itinerary) ? pkg.itinerary.length : 0,
      `${SITE_ORIGIN}/en/packages/${slug}/`,
      `${SITE_ORIGIN}/de/packages/${slug}/`,
      `${SITE_ORIGIN}/fr/packages/${slug}/`,
      `${SITE_ORIGIN}/ja/packages/${slug}/`,
      `${SITE_ORIGIN}/es/packages/${slug}/`,
    ];

    rows.push(values.map(csvEscape).join(","));
  }

  return rows.join("\n") + "\n";
}

function main() {
  mkdirSync(exportsDir, { recursive: true });
  mkdirSync(publicExportsDir, { recursive: true });

  const rawDestinations = readJsonFolder("destinations");
  const rawPackages = readJsonFolder("packages");
  const rawPages = readJsonFolder("pages");
  const rawSettings = readJsonFolder("settings");
  const rawBlogPosts = readJsonFolder("blog");

  const sanityDestinations = rawDestinations.map(toSanityDestination);
  const sanityPackages = rawPackages.map(toSanityPackage);
  const sanityPages = rawPages.map(toSanityStaticPage);
  const sanitySettings = toSanitySettings(rawSettings);
  const sanityBlogPosts = rawBlogPosts.map(toSanityBlogPost);

  const allSanityDocs = [
    ...sanitySettings,
    ...sanityDestinations,
    ...sanityPackages,
    ...sanityPages,
    ...sanityBlogPosts,
  ];

  // 1. Sanity NDJSON
  const ndjsonContent = allSanityDocs.map((doc) => JSON.stringify(doc)).join("\n") + "\n";

  // 2. Full structured JSON catalog
  const publishedPackages = sanityPackages.filter((p) => p.published);
  const publishedDestinations = sanityDestinations.filter((d) => d.published);
  const catalogBundle = {
    schemaVersion: "2026-10-sanity-v3",
    siteOrigin: SITE_ORIGIN,
    locales: LOCALES,
    counts: {
      totalSanityDocuments: allSanityDocs.length,
      destinationsTotal: sanityDestinations.length,
      destinationsPublished: publishedDestinations.length,
      packagesTotal: sanityPackages.length,
      packagesPublished: publishedPackages.length,
      packagesDayTours: publishedPackages.filter((p) => p.isDayTour).length,
      packagesMultiDay: publishedPackages.filter((p) => !p.isDayTour).length,
      staticPagesTotal: sanityPages.length,
      blogPostsTotal: sanityBlogPosts.length,
      siteSettingsTotal: sanitySettings.length,
    },
    settings: Object.fromEntries(rawSettings.map((s) => [s.id, s.data])),
    destinations: sanityDestinations,
    packages: sanityPackages,
    pages: sanityPages,
    blogPosts: sanityBlogPosts,
  };
  const jsonContent = JSON.stringify(catalogBundle, null, 2) + "\n";

  // 3. Flattened Packages CSV
  const csvContent = buildPackagesCsv(sanityPackages);

  const outputs = [
    { name: "sanity-dataset.ndjson", content: ndjsonContent },
    { name: "sunday-atlas-catalog.json", content: jsonContent },
    { name: "sunday-atlas-packages.csv", content: csvContent },
  ];

  for (const out of outputs) {
    const expPath = join(exportsDir, out.name);
    const pubPath = join(publicExportsDir, out.name);
    writeFileSync(expPath, out.content, "utf8");
    writeFileSync(pubPath, out.content, "utf8");
    const sizeKb = (statSync(expPath).size / 1024).toFixed(1);
    console.log(`  ✓ ${out.name} (${sizeKb} KB) -> exports/ & public/exports/`);
  }

  console.log(
    `\nCMS Export complete: ${allSanityDocs.length} Sanity documents (${sanityDestinations.length} destinations [${publishedDestinations.length} live], ${sanityPackages.length} packages [${publishedPackages.length} live], ${sanityPages.length} pages, ${sanityBlogPosts.length} blogPosts, ${sanitySettings.length} siteSettings).`,
  );
}

main();
