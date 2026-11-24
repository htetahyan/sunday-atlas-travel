"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fill } from "@/lib/paths";

export type TourTypeFilter = "all" | "multi-day" | "day-tour";

export type CatalogItem = {
  slug: string;
  isDayTour: boolean;
  regionKeys: string[];
  card: ReactNode;
};

export type RegionOption = {
  key: string;
  label: string;
};

export type PackagesCatalogLabels = {
  filterRegionLabel: string;
  filterAllRegions: string;
  filterTypeLabel: string;
  filterAllTypes: string;
  filterMultiDay: string;
  filterDayTours: string;
  filterClear: string;
  filterShowing: string;
  filterEmpty: string;
  paginationLabel: string;
  paginationPrev: string;
  paginationNext: string;
  paginationPage: string;
};

const DEFAULT_PAGE_SIZE = 6;

export function buildPageSequence(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  } else if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
  }
  const sorted = Array.from(pages)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const page = sorted[i];
    const prev = sorted[i - 1];
    if (prev !== undefined && page - prev > 1) {
      out.push("ellipsis");
    }
    out.push(page);
  }
  return out;
}

export function PackagesCatalog({
  items,
  regions,
  labels,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  items: CatalogItem[];
  regions: RegionOption[];
  labels: PackagesCatalogLabels;
  pageSize?: number;
}) {
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [tourType, setTourType] = useState<TourTypeFilter>("all");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [initialized, setInitialized] = useState<boolean>(false);
  const catalogTopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const regionParam = params.get("region")?.trim().toLowerCase();
      const typeParam = params.get("type");
      const pageParam = Number(params.get("page"));

      if (regionParam) {
        const slugified = regionParam.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const matched = regions.find(
          (r) =>
            r.key.toLowerCase() === regionParam ||
            r.key.toLowerCase() === slugified ||
            r.label.toLowerCase() === regionParam,
        );
        setSelectedRegion(matched ? matched.key : "all");
      } else {
        setSelectedRegion("all");
      }

      if (typeParam === "multi-day" || typeParam === "day-tour" || typeParam === "all") {
        setTourType(typeParam);
      } else {
        setTourType("all");
      }

      if (Number.isInteger(pageParam) && pageParam >= 1) {
        setCurrentPage(pageParam);
      } else {
        setCurrentPage(1);
      }
      setInitialized(true);
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [regions]);

  const filteredItems = items.filter((item) => {
    if (selectedRegion !== "all" && !item.regionKeys.includes(selectedRegion)) {
      return false;
    }
    if (tourType === "multi-day" && item.isDayTour) {
      return false;
    }
    if (tourType === "day-tour" && !item.isDayTour) {
      return false;
    }
    return true;
  });

  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / safePageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safePage - 1) * safePageSize;
  const paginatedItems = filteredItems.slice(startIndex, startIndex + safePageSize);
  const visibleSlugs = new Set(paginatedItems.map((item) => item.slug));
  const hasActiveFilter = selectedRegion !== "all" || tourType !== "all";
  const pageSequence = buildPageSequence(safePage, totalPages);

  useEffect(() => {
    if (!initialized || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (selectedRegion === "all") params.delete("region");
    else params.set("region", selectedRegion);

    if (tourType === "all") params.delete("type");
    else params.set("type", tourType);

    if (safePage <= 1) params.delete("page");
    else params.set("page", String(safePage));

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [initialized, selectedRegion, tourType, safePage]);

  const handleRegionChange = (regionKey: string) => {
    setSelectedRegion(regionKey);
    setCurrentPage(1);
  };

  const handleTourTypeChange = (nextType: TourTypeFilter) => {
    setTourType(nextType);
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setSelectedRegion("all");
    setTourType("all");
    setCurrentPage(1);
  };

  const handlePageChange = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), totalPages);
    if (clamped === safePage) return;
    setCurrentPage(clamped);
    if (catalogTopRef.current) {
      catalogTopRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const pillClass = (active: boolean) =>
    `inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? "border-teal bg-teal text-white"
        : "border-line bg-cream text-ink hover:border-teal hover:text-teal"
    }`;

  return (
    <div ref={catalogTopRef} className="mt-8">
      <div className="rounded-2xl border border-line bg-card p-5 shadow-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          {regions.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sand-deep">
                {labels.filterRegionLabel}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label={labels.filterRegionLabel}>
                <button
                  type="button"
                  onClick={() => handleRegionChange("all")}
                  aria-pressed={selectedRegion === "all"}
                  className={pillClass(selectedRegion === "all")}
                >
                  {labels.filterAllRegions}
                </button>
                {regions.map((region) => (
                  <button
                    key={region.key}
                    type="button"
                    onClick={() => handleRegionChange(region.key)}
                    aria-pressed={selectedRegion === region.key}
                    className={pillClass(selectedRegion === region.key)}
                  >
                    {region.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sand-deep">
              {labels.filterTypeLabel}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label={labels.filterTypeLabel}>
              <button
                type="button"
                onClick={() => handleTourTypeChange("all")}
                aria-pressed={tourType === "all"}
                className={pillClass(tourType === "all")}
              >
                {labels.filterAllTypes}
              </button>
              <button
                type="button"
                onClick={() => handleTourTypeChange("multi-day")}
                aria-pressed={tourType === "multi-day"}
                className={pillClass(tourType === "multi-day")}
              >
                {labels.filterMultiDay}
              </button>
              <button
                type="button"
                onClick={() => handleTourTypeChange("day-tour")}
                aria-pressed={tourType === "day-tour"}
                className={pillClass(tourType === "day-tour")}
              >
                {labels.filterDayTours}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5 text-sm text-muted">
          <p aria-live="polite">
            {fill(labels.filterShowing, {
              shown: paginatedItems.length,
              total: totalPages === 1 ? items.length : filteredItems.length,
            })}
          </p>
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={handleClearFilters}
              className="font-semibold text-teal underline-offset-4 hover:underline"
            >
              {labels.filterClear}
            </button>
          ) : null}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-card px-5 py-10 text-center">
          <p className="text-muted">{labels.filterEmpty}</p>
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={handleClearFilters}
              className="mt-4 inline-flex items-center justify-center rounded-full border border-line bg-cream px-5 py-2.5 text-sm font-semibold text-ink hover:border-teal hover:text-teal"
            >
              {labels.filterClear}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div data-reveal-group className="mt-8 grid gap-5 md:grid-cols-2">
            {items.map((item) => {
              const isVisible = visibleSlugs.has(item.slug);
              return (
                <div
                  key={item.slug}
                  hidden={!isVisible}
                  className={isVisible ? "h-full min-w-0" : "hidden"}
                >
                  {item.card}
                </div>
              );
            })}
          </div>

          <nav
            aria-label={labels.paginationLabel}
            className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6"
          >
            <p className="text-sm text-muted">
              {fill(labels.paginationPage, { current: safePage, total: totalPages })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handlePageChange(safePage - 1)}
                disabled={safePage <= 1}
                className="inline-flex items-center justify-center rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line disabled:hover:text-ink"
              >
                {labels.paginationPrev}
              </button>
              {pageSequence.map((entry, index) => {
                if (entry === "ellipsis") {
                  return (
                    <span
                      key={`ellipsis-${index}`}
                      aria-hidden="true"
                      className="inline-flex h-9 min-w-[1.75rem] items-center justify-center px-1 text-sm text-muted"
                    >
                      …
                    </span>
                  );
                }
                const active = entry === safePage;
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => handlePageChange(entry)}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-full border px-3 text-sm font-semibold transition-colors ${
                      active
                        ? "border-teal bg-teal text-white"
                        : "border-line bg-card text-ink hover:border-teal hover:text-teal"
                    }`}
                  >
                    {entry}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => handlePageChange(safePage + 1)}
                disabled={safePage >= totalPages}
                className="inline-flex items-center justify-center rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line disabled:hover:text-ink"
              >
                {labels.paginationNext}
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
