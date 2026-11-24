import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CmsExportDashboard,
  type ExportDestinationItem,
  type ExportPackageItem,
  type ExportStaticPageItem,
} from "@/components/CmsExportDashboard";
import { isLocale, isPartialLocale, locales } from "@/i18n/config";
import {
  getAllDestinations,
  getAllPackages,
  getAllStaticPages,
  isTranslated,
  pick,
} from "@/lib/content";
import { pageRobots } from "@/lib/metadata";

type Props = { params: Promise<{ locale: string }> };

export const dynamicParams = false;

/** Internal export view for the five full locales only. */
export function generateStaticParams() {
  return locales.filter((locale) => !isPartialLocale(locale)).map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: "Sanity.io CMS Migration & 1-Click Export Hub | Sunday Atlas Travel",
    description:
      "One-click export and Sanity.io v3 headless CMS migration hub for Sunday Atlas Travel (NDJSON, JSON, and CSV catalog bundles).",
    robots: pageRobots(true),
  };
}

function getExportFileSizeKb(filename: string, fallback: string): string {
  try {
    const file = path.join(process.cwd(), "public", "exports", filename);
    if (!fs.existsSync(file)) return fallback;
    return (fs.statSync(file).size / 1024).toFixed(1);
  } catch {
    return fallback;
  }
}

export default async function CmsExportPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const allPackages = getAllPackages();
  const allDestinations = getAllDestinations();
  const allStaticPages = getAllStaticPages();

  const packageItems: ExportPackageItem[] = allPackages.map((pkg) => {
    const translated = locales.filter(
      (loc) => isTranslated(pkg.title, loc) && isTranslated(pkg.summary, loc),
    );
    return {
      sanityId: `travelPackage-${pkg.slug}`,
      slug: pkg.slug,
      titleEn: pick(pkg.title, "en"),
      destination: pkg.destination,
      countries: pkg.countries,
      durationDays: pkg.durationDays,
      nights: pkg.nights,
      isDayTour: pkg.isDayTour,
      priceFrom: pkg.priceFrom,
      currency: pkg.currency,
      fromLabelEn: pick(pkg.fromLabel, "en"),
      styleEn: pick(pkg.style, "en"),
      featured: pkg.featured,
      published: pkg.published,
      sample: pkg.sample,
      itineraryCount: pkg.itinerary.length,
      galleryCount: pkg.gallery.length,
      localesTranslated: translated,
      sanityDocumentPreview: {
        _id: `travelPackage-${pkg.slug}`,
        _type: "travelPackage",
        slug: pkg.slug,
        title: pkg.title,
        destination: pkg.destination,
        countries: pkg.countries,
        durationDays: pkg.durationDays,
        nights: pkg.nights,
        isDayTour: pkg.isDayTour,
        priceFrom: pkg.priceFrom,
        currency: pkg.currency,
        fromLabel: pkg.fromLabel,
        itineraryDaysCount: pkg.itinerary.length,
        galleryPhotosCount: pkg.gallery.length,
        published: pkg.published,
      },
    };
  });

  const destinationItems: ExportDestinationItem[] = allDestinations.map((dest) => {
    const translated = locales.filter(
      (loc) => isTranslated(dest.name, loc) && isTranslated(dest.summary, loc),
    );
    return {
      sanityId: `destination-${dest.slug}`,
      slug: dest.slug,
      nameEn: pick(dest.name, "en"),
      regionEn: pick(dest.region, "en"),
      published: dest.published,
      sample: dest.sample,
      highlightsCount: pick(dest.highlights, "en").length,
      galleryCount: dest.gallery.length,
      faqsCount: dest.faqs.length,
      localesTranslated: translated,
    };
  });

  const staticPageItems: ExportStaticPageItem[] = allStaticPages.map((page) => ({
    sanityId: `staticPage-${page.id}`,
    id: page.id,
    title: page.title,
    sectionsCount: page.sections.length,
    faqsCount: page.faqs.length,
  }));

  const fileSizes = {
    ndjsonKb: getExportFileSizeKb("sanity-dataset.ndjson", "1010.1"),
    jsonKb: getExportFileSizeKb("sunday-atlas-catalog.json", "1230.4"),
    csvKb: getExportFileSizeKb("sunday-atlas-packages.csv", "25.3"),
  };

  const totalSanityDocs =
    packageItems.length + destinationItems.length + staticPageItems.length + 1;
  const publishedPackagesCount = packageItems.filter((p) => p.published).length;
  const publishedDestinationsCount = destinationItems.filter((d) => d.published).length;

  return (
    <main id="main" tabIndex={-1}>
      <div className="mx-auto max-w-page px-5 py-12 md:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
          Plan 2 · Sanity.io Headless CMS Migration &amp; 1-Click Data Exporter
        </p>
        <h1 className="mt-3 max-w-4xl font-serif text-4xl tracking-tight text-ink sm:text-5xl">
          Sanity.io CMS &amp; 1-Click Catalog Export
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted">
          Download the complete Sunday Atlas Travel catalog as a Sanity.io v3{" "}
          <code className="rounded bg-sand/70 px-1.5 py-0.5 text-sm text-ink">.ndjson</code>{" "}
          dataset, a universal 5-locale <code className="rounded bg-sand/70 px-1.5 py-0.5 text-sm text-ink">.json</code>{" "}
          bundle, or a flattened <code className="rounded bg-sand/70 px-1.5 py-0.5 text-sm text-ink">.csv</code>{" "}
          spreadsheet—with zero manual re-entry.
        </p>

        {/* Summary Metric Cards */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-line bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Tour Packages
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">{packageItems.length}</p>
            <p className="mt-1 text-xs text-muted">
              {publishedPackagesCount} live ({packageItems.filter((p) => p.published && !p.isDayTour).length} multi-day ·{" "}
              {packageItems.filter((p) => p.published && p.isDayTour).length} day tours) +{" "}
              {packageItems.length - publishedPackagesCount} sample
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Destinations
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">{destinationItems.length}</p>
            <p className="mt-1 text-xs text-muted">
              {publishedDestinationsCount} live countries +{" "}
              {destinationItems.length - publishedDestinationsCount} sample
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Sanity Documents
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">{totalSanityDocs}</p>
            <p className="mt-1 text-xs text-muted">
              {staticPageItems.length} static pages + 1 global SEO settings doc
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Translated Locales
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">5 / 5</p>
            <p className="mt-1 text-xs text-muted">
              EN · DE · FR · JA · ES (100% parity)
            </p>
          </div>
        </div>

        <CmsExportDashboard
          locale={locale}
          packages={packageItems}
          destinations={destinationItems}
          staticPages={staticPageItems}
          fileSizes={fileSizes}
          totalSanityDocs={totalSanityDocs}
        />
      </div>
    </main>
  );
}
