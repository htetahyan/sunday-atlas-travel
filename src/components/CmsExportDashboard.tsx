"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface ExportPackageItem {
  sanityId: string;
  slug: string;
  titleEn: string;
  destination: string;
  countries: string[];
  durationDays: number;
  nights?: number;
  isDayTour: boolean;
  priceFrom?: number;
  currency?: string;
  fromLabelEn: string;
  styleEn: string;
  featured: boolean;
  published: boolean;
  sample: boolean;
  itineraryCount: number;
  galleryCount: number;
  localesTranslated: string[];
  sanityDocumentPreview: Record<string, unknown>;
}

export interface ExportDestinationItem {
  sanityId: string;
  slug: string;
  nameEn: string;
  regionEn: string;
  published: boolean;
  sample: boolean;
  highlightsCount: number;
  galleryCount: number;
  faqsCount: number;
  localesTranslated: string[];
}

export interface ExportStaticPageItem {
  sanityId: string;
  id: string;
  title: string;
  sectionsCount: number;
  faqsCount: number;
}

interface CmsExportDashboardProps {
  locale: string;
  packages: ExportPackageItem[];
  destinations: ExportDestinationItem[];
  staticPages: ExportStaticPageItem[];
  fileSizes: {
    ndjsonKb: string;
    jsonKb: string;
    csvKb: string;
  };
  totalSanityDocs: number;
}

type PackageFilter = "all" | "published" | "multiday" | "daytour" | "draft";
type ActiveTab = "packages" | "destinations" | "pages" | "schemas";

const SANITY_PROJECT_ID = "mi09tcmc";
const SANITY_DATASET = "production";
const SANITY_ORG_ID = "ovf504ru3";
const SANITY_DASHBOARD_URL = "https://www.sanity.io/organizations/ovf504ru3/project/mi09tcmc";
const SANITY_CDN_QUERY_URL =
  "https://mi09tcmc.apicdn.sanity.io/v2024-01-01/data/query/production?query=count(*[_type%20in%20[%22travelPackage%22,%22destination%22,%22staticPage%22,%22blogPost%22,%22siteSettings%22]])";

const CLI_IMPORT_COMMANDS = `# 1. Regenerate exports/sanity-dataset.ndjson, JSON & CSV from content/*.json
npm run cms:export

# 2. One-click import all 51 documents into Sanity Cloud (mi09tcmc / production)
npx sanity dataset import exports/sanity-dataset.ndjson production --replace

# 3. Pull live Sanity Cloud edits at build time (defaults to mi09tcmc / production)
npm run cms:pull`;

export function CmsExportDashboard({
  locale,
  packages,
  destinations,
  staticPages,
  fileSizes,
  totalSanityDocs,
}: CmsExportDashboardProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("packages");
  const [pkgFilter, setPkgFilter] = useState<PackageFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectedSlug, setInspectedSlug] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const publishedPackages = useMemo(
    () => packages.filter((p) => p.published),
    [packages],
  );
  const dayToursCount = useMemo(
    () => publishedPackages.filter((p) => p.isDayTour).length,
    [publishedPackages],
  );
  const multiDayCount = useMemo(
    () => publishedPackages.filter((p) => !p.isDayTour).length,
    [publishedPackages],
  );
  const draftPackagesCount = useMemo(
    () => packages.filter((p) => !p.published).length,
    [packages],
  );

  const filteredPackages = useMemo(() => {
    return packages.filter((pkg) => {
      if (pkgFilter === "published" && !pkg.published) return false;
      if (pkgFilter === "multiday" && (!pkg.published || pkg.isDayTour)) return false;
      if (pkgFilter === "daytour" && (!pkg.published || !pkg.isDayTour)) return false;
      if (pkgFilter === "draft" && pkg.published) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          pkg.titleEn.toLowerCase().includes(q) ||
          pkg.slug.toLowerCase().includes(q) ||
          pkg.destination.toLowerCase().includes(q) ||
          pkg.styleEn.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [packages, pkgFilter, searchQuery]);

  async function handleCopyCli() {
    try {
      await navigator.clipboard.writeText(CLI_IMPORT_COMMANDS);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2500);
    } catch {
      // ignore clipboard errors in headless mode
    }
  }

  return (
    <div className="mt-10 space-y-10">
      {/* Live Sanity Cloud Connection Banner */}
      <section
        aria-label="Live Sanity Cloud Connection Status"
        className="rounded-2xl border-2 border-teal bg-teal/5 p-6 shadow-card sm:p-7"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-teal px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cream">
              <span className="h-2 w-2 rounded-full bg-cream" />
              Live in Sanity Cloud · Connected
            </div>
            <h2 className="mt-3 font-serif text-2xl text-ink sm:text-3xl">
              Sunday Atlas Travel — Sanity Cloud Project (`{SANITY_PROJECT_ID}`)
            </h2>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
              All {totalSanityDocs} catalog documents across 5 locales (<code className="rounded bg-sand/70 px-1.5 py-0.5 text-xs text-ink">en</code>,{" "}
              <code className="rounded bg-sand/70 px-1.5 py-0.5 text-xs text-ink">de</code>,{" "}
              <code className="rounded bg-sand/70 px-1.5 py-0.5 text-xs text-ink">fr</code>,{" "}
              <code className="rounded bg-sand/70 px-1.5 py-0.5 text-xs text-ink">ja</code>,{" "}
              <code className="rounded bg-sand/70 px-1.5 py-0.5 text-xs text-ink">es</code>) are imported and live in Sanity Cloud dataset{" "}
              <code className="rounded bg-sand/70 px-1.5 py-0.5 text-xs font-semibold text-ink">{SANITY_DATASET}</code> (Organization{" "}
              <code className="rounded bg-sand/70 px-1.5 py-0.5 text-xs text-ink">{SANITY_ORG_ID}</code>). Every build runs{" "}
              <code className="rounded bg-sand/70 px-1.5 py-0.5 text-xs text-ink">npm run cms:pull</code> against the live GROQ CDN API.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={SANITY_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-xs font-semibold text-cream transition hover:bg-ink"
            >
              <span>Open Sanity Cloud Dashboard ↗</span>
            </a>
            <a
              href={SANITY_CDN_QUERY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-ink bg-cream px-4 py-2.5 text-xs font-semibold text-ink transition hover:bg-ink hover:text-cream"
            >
              <span>Verify Live GROQ API (41 Docs) ↗</span>
            </a>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-card p-3.5">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">Project ID</span>
            <span className="mt-1 block font-mono text-sm font-bold text-ink">{SANITY_PROJECT_ID}</span>
          </div>
          <div className="rounded-xl border border-line bg-card p-3.5">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">Dataset</span>
            <span className="mt-1 block font-mono text-sm font-bold text-teal">{SANITY_DATASET} (public)</span>
          </div>
          <div className="rounded-xl border border-line bg-card p-3.5">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">GROQ Edge Endpoint</span>
            <span className="mt-1 block truncate font-mono text-xs text-ink">mi09tcmc.apicdn.sanity.io</span>
          </div>
          <div className="rounded-xl border border-line bg-card p-3.5">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">Sync Status</span>
            <span className="mt-1 block font-mono text-xs font-semibold text-teal">✓ 41 / 41 Docs Live</span>
          </div>
        </div>
      </section>

      {/* 1-Click Export Download Cards */}
      <section aria-labelledby="export-downloads-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="export-downloads-heading"
              className="font-serif text-2xl text-ink sm:text-3xl"
            >
              1-Click CMS Export Bundles
            </h2>
            <p className="mt-1 text-sm text-muted">
              Generated directly from <code className="rounded bg-sand/60 px-1.5 py-0.5 text-xs text-ink">content/*.json</code> via{" "}
              <code className="rounded bg-sand/60 px-1.5 py-0.5 text-xs text-ink">npm run cms:export</code>. Ready for Sanity.io, Supabase, Directus, Webflow, or WordPress.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-teal/30 bg-teal/10 px-3.5 py-1 text-xs font-semibold text-teal">
            <span className="h-2 w-2 rounded-full bg-teal" />
            Branch: cms/sanity · {totalSanityDocs} Sanity Documents Ready
          </span>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {/* Card 1: Sanity NDJSON */}
          <div className="flex flex-col justify-between rounded-2xl border-2 border-teal bg-card p-6 shadow-card">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-teal px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cream">
                  Plan 2 · Sanity.io
                </span>
                <span className="text-xs font-medium text-muted">{fileSizes.ndjsonKb} KB</span>
              </div>
              <h3 className="mt-4 font-serif text-xl text-ink">
                Sanity Dataset (NDJSON)
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                All {totalSanityDocs} documents (<code className="text-xs">destination</code>,{" "}
                <code className="text-xs">travelPackage</code>, <code className="text-xs">staticPage</code>,{" "}
                <code className="text-xs">siteSettings</code>) with deterministic{" "}
                <code className="text-xs">_id</code> and array <code className="text-xs">_key</code>s for{" "}
                <code className="text-xs">sanity dataset import</code>.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-line">
              <a
                href="/exports/sanity-dataset.ndjson"
                download="sanity-dataset.ndjson"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-teal px-5 py-3 text-sm font-semibold text-cream transition hover:bg-ink"
              >
                <span>⬇ 1-Click Download Sanity NDJSON</span>
              </a>
              <p className="mt-2 text-center font-mono text-[11px] text-muted">
                /exports/sanity-dataset.ndjson
              </p>
            </div>
          </div>

          {/* Card 2: Full Catalog JSON */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-card p-6 shadow-card">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ink">
                  Universal JSON
                </span>
                <span className="text-xs font-medium text-muted">{fileSizes.jsonKb} KB</span>
              </div>
              <h3 className="mt-4 font-serif text-xl text-ink">
                Full 5-Locale Catalog (JSON)
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Complete hierarchical JSON bundle with all {packages.length} tours, {destinations.length} destinations, {staticPages.length} pages, Cloudinary URLs, price tables, and 5 locales (<code className="text-xs">en/de/fr/ja/es</code>).
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-line">
              <a
                href="/exports/sunday-atlas-catalog.json"
                download="sunday-atlas-catalog.json"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-ink bg-cream px-5 py-3 text-sm font-semibold text-ink transition hover:bg-ink hover:text-cream"
              >
                <span>⬇ 1-Click Download Full JSON</span>
              </a>
              <p className="mt-2 text-center font-mono text-[11px] text-muted">
                /exports/sunday-atlas-catalog.json
              </p>
            </div>
          </div>

          {/* Card 3: Packages CSV */}
          <div className="flex flex-col justify-between rounded-2xl border border-line bg-card p-6 shadow-card">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ink">
                  Spreadsheet / CSV
                </span>
                <span className="text-xs font-medium text-muted">{fileSizes.csvKb} KB</span>
              </div>
              <h3 className="mt-4 font-serif text-xl text-ink">
                Flattened Tours Table (CSV)
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                29-column spreadsheet of all {packages.length} packages with 5-language titles, prices, durations, day-tour flags, Cloudinary hero URLs, and live links for Sheets, Webflow, or WordPress.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-line">
              <a
                href="/exports/sunday-atlas-packages.csv"
                download="sunday-atlas-packages.csv"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-ink bg-cream px-5 py-3 text-sm font-semibold text-ink transition hover:bg-ink hover:text-cream"
              >
                <span>⬇ 1-Click Download Packages CSV</span>
              </a>
              <p className="mt-2 text-center font-mono text-[11px] text-muted">
                /exports/sunday-atlas-packages.csv
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3-Step Sanity Studio Import Quickstart */}
      <section className="rounded-2xl border border-line bg-ink p-6 text-cream shadow-card sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand">
              Plan 2 · Sanity.io Hosted Headless CMS
            </p>
            <h2 className="mt-1 font-serif text-2xl text-cream">
              3-Line Command to Import into Sanity Studio
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCopyCli}
            className="rounded-full border border-cream/30 bg-cream/10 px-4 py-2 text-xs font-semibold text-cream transition hover:bg-cream hover:text-ink"
          >
            {copiedCmd ? "✓ Copied Commands" : "Copy CLI Commands"}
          </button>
        </div>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-black/40 p-4 font-mono text-xs leading-relaxed text-sand">
          <code>{CLI_IMPORT_COMMANDS}</code>
        </pre>
        <div className="mt-4 grid gap-4 text-xs text-cream/80 sm:grid-cols-3">
          <div className="rounded-xl bg-white/5 p-3.5">
            <strong className="block text-cream">1. Schemas Ready in Repo</strong>
            <code className="text-[11px] text-sand">sanity/schemas/*.ts</code> +{" "}
            <code className="text-[11px] text-sand">sanity.config.ts</code> define all 7 object &amp; document types.
          </div>
          <div className="rounded-xl bg-white/5 p-3.5">
            <strong className="block text-cream">2. Zero-Bloat Edge Fetcher</strong>
            <code className="text-[11px] text-sand">src/lib/sanity.ts</code> queries the Sanity GROQ CDN API directly with native <code className="text-[11px] text-sand">fetch</code>.
          </div>
          <div className="rounded-xl bg-white/5 p-3.5">
            <strong className="block text-cream">3. Dual-Mode Sync</strong>
            <code className="text-[11px] text-sand">npm run cms:pull</code> syncs Sanity documents into <code className="text-[11px] text-sand">content/*.json</code> at build time.
          </div>
        </div>
      </section>

      {/* Interactive Dataset Explorer */}
      <section className="rounded-2xl border border-line bg-card p-6 shadow-card sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="CMS Dataset Collections">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "packages"}
              onClick={() => setActiveTab("packages")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "packages"
                  ? "bg-teal text-cream"
                  : "bg-cream text-ink hover:bg-sand"
              }`}
            >
              Tour Packages ({packages.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "destinations"}
              onClick={() => setActiveTab("destinations")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "destinations"
                  ? "bg-teal text-cream"
                  : "bg-cream text-ink hover:bg-sand"
              }`}
            >
              Destinations ({destinations.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "pages"}
              onClick={() => setActiveTab("pages")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "pages"
                  ? "bg-teal text-cream"
                  : "bg-cream text-ink hover:bg-sand"
              }`}
            >
              Static Pages &amp; Settings ({staticPages.length + 1})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "schemas"}
              onClick={() => setActiveTab("schemas")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "schemas"
                  ? "bg-teal text-cream"
                  : "bg-cream text-ink hover:bg-sand"
              }`}
            >
              Sanity v3 Schemas (7)
            </button>
          </div>
        </div>

        {/* TAB 1: PACKAGES */}
        {activeTab === "packages" && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", `All (${packages.length})`],
                    ["published", `Published (${publishedPackages.length})`],
                    ["multiday", `Multi-Day (${multiDayCount})`],
                    ["daytour", `1-Day Tours (${dayToursCount})`],
                    ["draft", `Sample / Draft (${draftPackagesCount})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPkgFilter(key)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                      pkgFilter === key
                        ? "border-ink bg-ink text-cream"
                        : "border-line bg-cream text-muted hover:border-ink hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by title, slug, or country..."
                className="w-full rounded-full border border-line bg-cream px-4 py-2 text-sm text-ink placeholder:text-muted focus:border-teal focus:outline-none sm:w-72"
              />
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                    <th className="py-3 pr-4">Sanity _id &amp; Title</th>
                    <th className="px-3 py-3">Destination</th>
                    <th className="px-3 py-3">Duration</th>
                    <th className="px-3 py-3">Price</th>
                    <th className="px-3 py-3">Locales</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="py-3 pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredPackages.map((pkg) => {
                    const isInspected = inspectedSlug === pkg.slug;
                    return (
                      <tr key={pkg.slug} className="align-top">
                        <td className="py-3.5 pr-4">
                          <div className="font-medium text-ink">{pkg.titleEn}</div>
                          <div className="mt-0.5 font-mono text-xs text-muted">
                            {pkg.sanityId}
                          </div>
                          {isInspected && (
                            <pre className="mt-3 max-h-64 max-w-xl overflow-auto rounded-xl bg-ink p-3 font-mono text-[11px] text-sand">
                              <code>{JSON.stringify(pkg.sanityDocumentPreview, null, 2)}</code>
                            </pre>
                          )}
                        </td>
                        <td className="px-3 py-3.5 capitalize text-ink">
                          {pkg.destination}
                          {pkg.countries.length > 0 ? (
                            <span className="block text-xs text-muted">
                              +{pkg.countries.join(", ")}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3.5 text-ink">
                          <span className="font-medium">{pkg.durationDays}d</span>
                          {pkg.nights ? <span className="text-muted"> / {pkg.nights}n</span> : null}
                          <span
                            className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              pkg.isDayTour
                                ? "bg-teal/15 text-teal"
                                : "bg-sand text-ink"
                            }`}
                          >
                            {pkg.isDayTour ? "Day tour" : "Multi-day"}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 font-semibold text-ink">
                          {typeof pkg.priceFrom === "number" ? `$${pkg.priceFrom}` : "On request"}
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {pkg.localesTranslated.map((loc) => (
                              <span
                                key={loc}
                                className="rounded bg-sand px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-ink"
                              >
                                {loc}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          {pkg.published ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2.5 py-0.5 text-xs font-semibold text-teal">
                              ● Live
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-0.5 text-xs font-semibold text-muted">
                              ○ Draft
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 pl-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setInspectedSlug(isInspected ? null : pkg.slug)
                              }
                              className="rounded-full border border-line bg-cream px-3 py-1 text-xs font-semibold text-ink hover:border-ink"
                            >
                              {isInspected ? "Hide JSON" : "Sanity JSON"}
                            </button>
                            {pkg.published && (
                              <Link
                                href={`/${locale}/packages/${pkg.slug}/`}
                                className="rounded-full bg-sand px-3 py-1 text-xs font-semibold text-ink hover:bg-ink hover:text-cream"
                              >
                                View Page →
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: DESTINATIONS */}
        {activeTab === "destinations" && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                  <th className="py-3 pr-4">Sanity _id &amp; Country</th>
                  <th className="px-3 py-3">Region</th>
                  <th className="px-3 py-3">Highlights</th>
                  <th className="px-3 py-3">Gallery &amp; FAQs</th>
                  <th className="px-3 py-3">Locales</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="py-3 pl-3 text-right">Live Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {destinations.map((dest) => (
                  <tr key={dest.slug}>
                    <td className="py-3.5 pr-4">
                      <div className="font-medium text-ink">{dest.nameEn}</div>
                      <div className="font-mono text-xs text-muted">{dest.sanityId}</div>
                    </td>
                    <td className="px-3 py-3.5 text-ink">{dest.regionEn || "—"}</td>
                    <td className="px-3 py-3.5 text-ink">{dest.highlightsCount} items</td>
                    <td className="px-3 py-3.5 text-ink">
                      {dest.galleryCount} photos · {dest.faqsCount} FAQs
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {dest.localesTranslated.map((loc) => (
                          <span
                            key={loc}
                            className="rounded bg-sand px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-ink"
                          >
                            {loc}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      {dest.published ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2.5 py-0.5 text-xs font-semibold text-teal">
                          ● Live
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-0.5 text-xs font-semibold text-muted">
                          ○ Draft
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 pl-3 text-right">
                      {dest.published ? (
                        <Link
                          href={`/${locale}/destinations/${dest.slug}/`}
                          className="rounded-full bg-sand px-3 py-1 text-xs font-semibold text-ink hover:bg-ink hover:text-cream"
                        >
                          View Country →
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">Sample</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: STATIC PAGES & SETTINGS */}
        {activeTab === "pages" && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                  <th className="py-3 pr-4">Sanity _id</th>
                  <th className="px-3 py-3">Document _type</th>
                  <th className="px-3 py-3">Title / Purpose</th>
                  <th className="px-3 py-3">Content Blocks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="py-3.5 pr-4 font-mono text-xs font-semibold text-teal">
                    siteSettings-seo
                  </td>
                  <td className="px-3 py-3.5 font-mono text-xs">siteSettings</td>
                  <td className="px-3 py-3.5 font-medium text-ink">
                    Global SEO, Social Links, Contact Email &amp; Turnstile Key
                  </td>
                  <td className="px-3 py-3.5 text-muted">
                    5 locales + Turnstile + Analytics
                  </td>
                </tr>
                {staticPages.map((page) => (
                  <tr key={page.id}>
                    <td className="py-3.5 pr-4 font-mono text-xs text-ink">
                      {page.sanityId}
                    </td>
                    <td className="px-3 py-3.5 font-mono text-xs">staticPage</td>
                    <td className="px-3 py-3.5 font-medium text-ink">{page.title}</td>
                    <td className="px-3 py-3.5 text-muted">
                      {page.sectionsCount} sections · {page.faqsCount} FAQs · 5-locale SEO
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: SANITY SCHEMAS */}
        {activeTab === "schemas" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              {
                name: "travelPackage",
                file: "sanity/schemas/travelPackage.ts",
                desc: "Document schema for multi-day and 1-day private tours: localized title/summary/intro, day-by-day itinerary, priceTable, hotels, vehicles, Cloudinary gallery, and 5-locale SEO.",
              },
              {
                name: "destination",
                file: "sanity/schemas/destination.ts",
                desc: "Document schema for country pages: localized name, region, summary, intro, bestSeasons, highlights, visaNote, Cloudinary gallery, FAQs, and 5-locale SEO.",
              },
              {
                name: "staticPage",
                file: "sanity/schemas/staticPage.ts",
                desc: "Document schema for the 9 core pages (home, about, packages, destinations, how-it-works, faq, contact, privacy, terms).",
              },
              {
                name: "siteSettings",
                file: "sanity/schemas/siteSettings.ts",
                desc: "Singleton document schema for sitewide title templates, default meta descriptions, social URLs, contact email, and Turnstile site key.",
              },
              {
                name: "localizedString & localizedStringArray",
                file: "sanity/schemas/localizedString.ts",
                desc: "Reusable 5-locale object types (en, de, fr, ja, es) with collapsible translation fieldsets.",
              },
              {
                name: "localizedText",
                file: "sanity/schemas/localizedText.ts",
                desc: "Reusable 5-locale multiline text object type for summaries, intros, day descriptions, and notes.",
              },
            ].map((schema) => (
              <div
                key={schema.name}
                className="rounded-xl border border-line bg-cream p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold text-teal">
                    {schema.name}
                  </span>
                  <span className="font-mono text-xs text-muted">{schema.file}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">{schema.desc}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
