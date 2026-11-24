"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/i18n/getDictionary";
import type { BlogCategory, BlogPost, Localized } from "@/lib/content";
import { CoverImage } from "@/components/CoverImage";
import { formatDisplayDate, lastModified } from "@/lib/dates";
import { fill } from "@/lib/paths";

const PAGE_SIZE = 9;

type DestinationOption = {
  slug: string;
  name: string;
};

const CATEGORIES: readonly BlogCategory[] = [
  "top-places",
  "destination-guide",
  "day-trips",
  "seasonal",
];

function pickText(val: Localized<string> | string | undefined, locale: string): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  const chosen = val[locale as keyof Localized<string>];
  if (typeof chosen === "string" && chosen.length > 0) return chosen;
  return typeof val.en === "string" ? val.en : "";
}

function getPostCountries(post: { destination?: string; countries?: readonly string[] }): string[] {
  const list = Array.isArray(post.countries) && post.countries.length > 0
    ? [...post.countries]
    : post.destination
      ? [post.destination]
      : [];
  return Array.from(new Set(list.filter(Boolean)));
}

function categoryLabel(category: BlogCategory, dict: Dictionary): string {
  switch (category) {
    case "top-places":
      return dict.blog.categoryTopPlaces;
    case "day-trips":
      return dict.blog.categoryDayTrips;
    case "seasonal":
      return dict.blog.categorySeasonal;
    case "destination-guide":
    default:
      return dict.blog.categoryDestinationGuide;
  }
}

export function BlogCatalog({
  posts,
  destinations,
  locale,
  dict,
}: {
  posts: BlogPost[];
  destinations: DestinationOption[];
  locale: string;
  dict: Dictionary;
}) {
  const [search, setSearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  const destMap = useMemo(() => {
    return new Map(destinations.map((d) => [d.slug, d.name]));
  }, [destinations]);

  const activeDestinations = useMemo(() => {
    const used = new Set(posts.flatMap((post) => getPostCountries(post)));
    return destinations.filter((dest) => used.has(dest.slug));
  }, [posts, destinations]);

  const activeCategories = useMemo(() => {
    const used = new Set(posts.map((post) => post.category));
    return CATEGORIES.filter((cat) => used.has(cat));
  }, [posts]);

  const searchablePosts = useMemo(() => {
    return posts.map((post) => {
      const title = pickText(post.title, locale);
      const subtitle = pickText(post.subtitle, locale);
      const summary = pickText(post.summary, locale);
      const seoKeywords =
        post.seo?.[locale as keyof typeof post.seo]?.keywords ||
        post.seo?.en?.keywords ||
        [];
      const haystack = [
        title,
        subtitle,
        summary,
        post.destination,
        ...getPostCountries(post),
        ...(post.sections || []).map(
          (s) => `${pickText(s.placeName, locale)} ${pickText(s.heading, locale)}`,
        ),
        ...seoKeywords,
      ]
        .join(" ")
        .toLowerCase();
      return { post, haystack };
    });
  }, [posts, locale]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return searchablePosts
      .filter(({ post, haystack }) => {
        const matchesCountry =
          selectedCountry === "all" ||
          getPostCountries(post).includes(selectedCountry);
        const matchesCategory =
          selectedCategory === "all" || post.category === selectedCategory;
        const matchesSearch = !query || haystack.includes(query);
        return matchesCountry && matchesCategory && matchesSearch;
      })
      .map(({ post }) => post);
  }, [searchablePosts, search, selectedCountry, selectedCategory]);

  const visiblePosts = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const hasFilters =
    selectedCountry !== "all" ||
    selectedCategory !== "all" ||
    search.trim().length > 0;

  const resetFilters = () => {
    setSearch("");
    setSelectedCountry("all");
    setSelectedCategory("all");
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-card p-5 shadow-card">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1.8fr] lg:items-end">
          <div>
            <label
              htmlFor="blog-search-input"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-sand-deep"
            >
              {dict.blog.searchLabel}
            </label>
            <div className="relative mt-2">
              <input
                id="blog-search-input"
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                placeholder={dict.blog.searchPlaceholder}
                className="w-full rounded-full border border-line bg-cream px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sand-deep">
              {dict.blog.filterCategoryLabel}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory("all");
                  setVisibleCount(PAGE_SIZE);
                }}
                aria-pressed={selectedCategory === "all"}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  selectedCategory === "all"
                    ? "border-teal bg-teal text-white"
                    : "border-line bg-cream text-ink hover:border-teal hover:text-teal"
                }`}
              >
                {dict.blog.filterAllCategories}
              </button>
              {activeCategories.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(active ? "all" : cat);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    aria-pressed={active}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "border-teal bg-teal text-white"
                        : "border-line bg-cream text-ink hover:border-teal hover:text-teal"
                    }`}
                  >
                    {categoryLabel(cat, dict)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sand-deep">
            {dict.blog.filterDestinationLabel}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedCountry("all");
                setVisibleCount(PAGE_SIZE);
              }}
              aria-pressed={selectedCountry === "all"}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                selectedCountry === "all"
                  ? "border-teal bg-teal text-white"
                  : "border-line bg-cream text-ink hover:border-teal hover:text-teal"
              }`}
            >
              {dict.blog.filterAllDestinations}
            </button>
            {activeDestinations.map((dest) => {
              const active = selectedCountry === dest.slug;
              return (
                <button
                  key={dest.slug}
                  type="button"
                  onClick={() => {
                    setSelectedCountry(active ? "all" : dest.slug);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  aria-pressed={active}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "border-teal bg-teal text-white"
                      : "border-line bg-cream text-ink hover:border-teal hover:text-teal"
                  }`}
                >
                  {dest.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
          <span>
            {dict.blog.filterShowing
              .replace("{shown}", String(visiblePosts.length))
              .replace("{total}", String(filtered.length))}
          </span>
          {hasFilters ? (
            <button
              type="button"
              onClick={resetFilters}
              className="font-semibold text-teal hover:underline"
            >
              {dict.blog.filterClear}
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-line bg-card p-8 text-center">
          <p className="font-serif text-xl text-ink">{dict.blog.filterEmpty}</p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 inline-flex items-center rounded-full bg-teal px-5 py-2.5 text-xs font-semibold text-white hover:bg-teal-dark"
          >
            {dict.blog.filterClear}
          </button>
        </div>
      ) : (
        <>
          <div data-reveal-group className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {visiblePosts.map((post) => {
              const title = pickText(post.title, locale);
              const summary = pickText(post.summary, locale);
              const countryNames = getPostCountries(post)
                .map((slug) => destMap.get(slug) || slug)
                .filter(Boolean);
              const catText = categoryLabel(post.category, dict);
              const readingLabel = dict.blog.readingTime.replace(
                "{minutes}",
                String(post.readingTimeMinutes || 8),
              );
              const rankedCount = (post.sections || []).filter(
                (s) => typeof s.rankNumber === "number",
              ).length;

              return (
                <article
                  key={post.slug}
                  className="atlas-card group relative flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card"
                >
                  <div
                    className="relative aspect-[16/9] overflow-hidden [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.02]"
                    style={{
                      backgroundImage: "linear-gradient(150deg, #0F6E6E, #1C2430)",
                    }}
                  >
                    {post.heroImage?.src ? (
                      <CoverImage
                        src={post.heroImage.src}
                        alt={pickText(post.heroImage.alt, locale) || title}
                        width={post.heroImage.width}
                        height={post.heroImage.height}
                        sizes="(min-width: 1200px) 365px, (min-width: 1024px) calc(33.33vw - 1.75rem), (min-width: 768px) calc(50vw - 2rem), calc(100vw - 2.5rem)"
                      />
                    ) : null}
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />
                    <div className="absolute left-4 right-4 top-3.5 flex items-center justify-between gap-2 text-xs font-semibold">
                      <span className="truncate rounded-full bg-ink/65 px-3 py-1 text-white backdrop-blur-sm">
                        {countryNames.join(" · ") || post.destination}
                      </span>
                      <span className="shrink-0 rounded-full bg-cream/95 px-2.5 py-1 text-ink shadow-sm">
                        {readingLabel}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          post.category === "top-places"
                            ? "border border-teal/30 bg-teal-soft text-teal"
                            : post.category === "seasonal"
                              ? "border border-line bg-cream text-sand-deep"
                              : "bg-teal-soft text-teal"
                        }`}
                      >
                        {catText}
                      </span>
                      {rankedCount > 0 ? (
                        <span className="text-xs font-medium text-muted">
                          · {rankedCount} stops
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-2.5 font-serif text-2xl leading-snug text-ink">
                      <Link
                        href={`/${locale}/blog/${post.slug}/`}
                        className="transition-colors group-hover:text-teal after:absolute after:inset-0 after:z-10 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-teal"
                      >
                        {title}
                      </Link>
                    </h3>
                    {summary ? (
                      <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted">
                        {summary}
                      </p>
                    ) : (
                      <div className="flex-1" />
                    )}
                    <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5 text-sm">
                      {formatDisplayDate(lastModified(post.publishedAt, post.updatedAt), locale) ? (
                        <time
                          className="text-xs text-muted"
                          dateTime={lastModified(post.publishedAt, post.updatedAt)}
                        >
                          {formatDisplayDate(lastModified(post.publishedAt, post.updatedAt), locale)}
                        </time>
                      ) : (
                        <span />
                      )}
                      <span
                        aria-hidden="true"
                        className="inline-flex items-center gap-1 font-semibold text-teal underline-offset-4 group-hover:underline"
                      >
                        {dict.cta.viewGuide} →
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {hasMore ? (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-6 py-3 text-sm font-semibold text-ink shadow-card transition-colors hover:border-teal hover:text-teal"
              >
                {fill(dict.blog.loadMore, { remaining: filtered.length - visiblePosts.length })}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
