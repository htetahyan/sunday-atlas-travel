import Link from "next/link";
import type { Dictionary } from "@/i18n/getDictionary";
import { getBlogPosts, getDestinations, getPackages, localizeBlogPost, packageCountries } from "@/lib/content";
import { formatDisplayDate, isoDateTime } from "@/lib/dates";
import { locales } from "@/i18n/config";
import { CountUp } from "./motion/CountUp";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function publishedMs(value: string | undefined): number {
  const ms = Date.parse(isoDateTime(value));
  return Number.isFinite(ms) ? ms : 0;
}

/** Newest published guides first (by publish date, not the featured flag). */
export function latestPosts(limit: number) {
  return [...getBlogPosts()]
    .sort((a, b) => publishedMs(b.publishedAt) - publishedMs(a.publishedAt))
    .slice(0, limit);
}

/** Real counts computed from site data. Nothing here is typed in by hand. */
export function siteStats() {
  const countries = new Set<string>();
  for (const destination of getDestinations()) countries.add(destination.slug);
  for (const travelPackage of getPackages()) packageCountries(travelPackage).forEach((slug) => countries.add(slug));
  return {
    packages: getPackages().length,
    countries: countries.size,
    guides: getBlogPosts().length,
    languages: locales.length,
  };
}

/** Count of guides published in the 7 days before the build (the site rebuilds daily). */
export function newThisWeekCount(): number {
  const now = Date.now();
  return getBlogPosts().filter((post) => now - publishedMs(post.publishedAt) <= WEEK_MS).length;
}

/** Scrolling "Fresh on the blog" ticker. Pauses on hover/focus; static and scrollable under reduced motion. */
export function LatestStrip({ locale, dict }: { locale: string; dict: Dictionary }) {
  const posts = latestPosts(6);
  if (posts.length === 0) return null;
  const now = Date.now();
  const items = posts.map((post) => {
    const copy = localizeBlogPost(post, locale);
    return {
      slug: copy.slug,
      title: copy.title,
      date: formatDisplayDate(post.publishedAt, locale),
      isNew: now - publishedMs(post.publishedAt) <= WEEK_MS,
    };
  });
  const renderList = (hidden: boolean) => (
    <ul className="ticker-list flex shrink-0 items-center gap-8 pr-8" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li key={item.slug} className="flex shrink-0 items-center gap-2 text-sm">
          {item.isNew ? (
            <span className="rounded-full bg-sand-deep px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-white">
              {dict.home.latest.newBadge}
            </span>
          ) : null}
          <Link
            href={`/${locale}/blog/${item.slug}/`}
            tabIndex={hidden ? -1 : undefined}
            className="max-w-[28rem] truncate font-medium text-ink underline-offset-4 hover:text-teal hover:underline"
          >
            {item.title}
          </Link>
          <span className="text-muted">· {item.date}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label={dict.home.latest.label} className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-page items-center gap-4 px-5 py-3">
        <p className="flex shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">
          <span className="live-dot" aria-hidden="true" />
          {dict.home.latest.label}
        </p>
        <div className="ticker relative min-w-0 flex-1 overflow-hidden">
          <div className="ticker-track flex w-max">
            {renderList(false)}
            {renderList(true)}
          </div>
        </div>
        <Link
          href={`/${locale}/blog/`}
          className="hidden shrink-0 text-sm font-semibold text-teal underline-offset-4 hover:underline sm:inline"
        >
          {dict.home.latest.viewAll} →
        </Link>
      </div>
    </section>
  );
}

/** Stats strip with animated counters. Every number is computed from content. */
export function StatsStrip({ dict }: { dict: Dictionary }) {
  const stats = siteStats();
  const rows = [
    { value: stats.packages, label: dict.home.stats.packages },
    { value: stats.countries, label: dict.home.stats.countries },
    { value: stats.guides, label: dict.home.stats.guides },
    { value: stats.languages, label: dict.home.stats.languages },
  ];
  return (
    <section aria-label={dict.home.stats.label} className="border-b border-line bg-ink text-white">
      <dl data-reveal-group className="mx-auto grid max-w-page grid-cols-2 gap-y-6 px-5 py-8 md:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col items-center text-center">
            <dt className="order-2 mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/75">{row.label}</dt>
            <dd className="order-1 font-serif text-4xl text-sand-soft md:text-5xl">
              <CountUp value={row.value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
