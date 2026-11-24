import Link from "next/link";
import { formatDisplayDate, lastModified } from "@/lib/dates";
import {
  formatPackageDuration,
  getDestination,
  imageAlt,
  blogCountries,
  localizeBlogPost,
  localizeDestination,
  localizePackage,
  packageCountries,
  pick,
  type BlogCategory,
  type BlogPost,
  type Destination,
  type TravelPackage,
} from "@/lib/content";
import type { Dictionary } from "@/i18n/getDictionary";
import { CoverImage } from "./CoverImage";

export function DestinationCard({
  destination,
  locale,
  dict,
}: {
  destination: Destination;
  locale: string;
  dict: Dictionary;
}) {
  const copy = localizeDestination(destination, locale);
  const [from, to] = copy.heroGradient;
  return (
    <article className="atlas-card group relative cursor-pointer flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <div
        className="relative h-40 overflow-hidden text-white [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.02]"
        style={{ backgroundImage: `linear-gradient(150deg, ${from}, ${to})` }}
      >
        {copy.image?.src ? (
          <CoverImage
            src={copy.image.src}
            alt={imageAlt(copy.image, locale)}
            width={copy.image.width}
            height={copy.image.height}
            sizes="(min-width: 1200px) 570px, (min-width: 768px) calc(50vw - 1.875rem), calc(100vw - 2.5rem)"
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/25 to-ink/10" />
        <div className="relative flex h-full flex-col justify-end p-5">
          {copy.region ? <p className="text-sm text-white/90">{copy.region}</p> : null}
          <h3 className="font-serif text-3xl leading-tight">{copy.name}</h3>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        {copy.summary ? <p className="text-sm leading-relaxed text-muted">{copy.summary}</p> : null}
        <Link
          href={`/${locale}/destinations/${copy.slug}/`}
          aria-label={copy.name}
          className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
        />
        <span
          aria-hidden="true"
          className="mt-5 inline-flex text-sm font-semibold text-teal underline-offset-4 group-hover:underline"
        >
          {dict.cta.viewDestination}
        </span>
      </div>
    </article>
  );
}

function publishedCountryNames(travelPackage: TravelPackage, locale: string): string[] {
  return packageCountries(travelPackage).flatMap((slug) => {
    const place = getDestination(slug);
    if (!place) return [];
    const name = pick(place.name, locale);
    return name ? [name] : [];
  });
}

export function PackageCard({
  travelPackage,
  locale,
  dict,
  imageSizes = "(min-width: 1200px) 570px, (min-width: 768px) calc(50vw - 1.875rem), calc(100vw - 2.5rem)",
  compact = false,
}: {
  travelPackage: TravelPackage;
  locale: string;
  dict: Dictionary;
  /** Matches the grid this card is rendered in. Defaults to a 1/2-column page grid. */
  imageSizes?: string;
  /** Image, title, duration, and price label only. */
  compact?: boolean;
}) {
  const copy = localizePackage(travelPackage, locale);
  const duration = formatPackageDuration(copy.durationDays, copy.nights, dict.packages);
  if (compact) {
    return (
      <article className="atlas-card group relative cursor-pointer flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        <div
          className="relative aspect-[16/9] overflow-hidden [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.02]"
          style={{ backgroundImage: "linear-gradient(150deg, #0F6E6E, #1C2430)" }}
        >
          {copy.image?.src ? (
            <CoverImage
              src={copy.image.src}
              alt={imageAlt(copy.image, locale)}
              width={copy.image.width}
              height={copy.image.height}
              sizes={imageSizes}
            />
          ) : null}
        </div>
        <div className="flex flex-1 flex-col p-5">
          {copy.isDayTour ? (
            <p className="mb-2">
              <span className="inline-flex items-center rounded-full bg-teal-soft px-2.5 py-0.5 text-xs font-semibold text-teal">
                {dict.packages.dayTourBadge}
              </span>
            </p>
          ) : null}
          <h3 className="font-serif text-2xl leading-snug text-ink">
            <Link href={`/${locale}/packages/${copy.slug}/`} className="transition-colors group-hover:text-teal after:absolute after:inset-0 after:z-10 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-teal">
              {copy.title}
            </Link>
          </h3>
          {duration ? <p className="mt-2 text-sm text-muted">{duration}</p> : null}
          <p className="mt-4 text-sm font-semibold text-ink">{copy.fromLabel || dict.packages.priceOnRequest}</p>
        </div>
      </article>
    );
  }
  const countryNames = publishedCountryNames(travelPackage, locale);
  const hasTopRow = countryNames.length > 0 || copy.isDayTour;
  return (
    <article className="atlas-card group relative cursor-pointer flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <div
        className="relative aspect-[16/9] overflow-hidden [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.02]"
        style={{ backgroundImage: "linear-gradient(150deg, #0F6E6E, #1C2430)" }}
      >
        {copy.image?.src ? (
          <CoverImage
            src={copy.image.src}
            alt={imageAlt(copy.image, locale)}
            width={copy.image.width}
            height={copy.image.height}
            sizes={imageSizes}
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {hasTopRow ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {countryNames.length > 0 ? <p className="text-sm text-muted">{countryNames.join(", ")}</p> : <span />}
            {copy.isDayTour ? (
              <span className="inline-flex items-center rounded-full bg-teal-soft px-2.5 py-0.5 text-xs font-semibold text-teal">
                {dict.packages.dayTourBadge}
              </span>
            ) : null}
          </div>
        ) : null}
        <h3 className={`${hasTopRow ? "mt-3" : ""} font-serif text-2xl leading-snug text-ink`}>
          <Link href={`/${locale}/packages/${copy.slug}/`} className="transition-colors group-hover:text-teal after:absolute after:inset-0 after:z-10 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-teal">
            {copy.title}
          </Link>
        </h3>
        {duration || copy.style ? (
          <p className="mt-2 text-sm text-muted">
            {duration || null}
            {duration && copy.style ? <span aria-hidden="true"> · </span> : null}
            {copy.style || null}
          </p>
        ) : null}
        {copy.summary ? (
          <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{copy.summary}</p>
        ) : (
          <div className="flex-1" />
        )}
        <p className="mt-4 text-sm font-semibold text-ink">{copy.fromLabel || dict.packages.priceOnRequest}</p>
        <span
          aria-hidden="true"
          className="mt-4 inline-flex text-sm font-semibold text-teal underline-offset-4 group-hover:underline"
        >
          {dict.cta.viewPackage}
        </span>
      </div>
    </article>
  );
}


export function formatBlogCategoryLabel(
  category: BlogCategory,
  dict: Dictionary,
): string {
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

export function BlogCard({
  post,
  locale,
  dict,
  imageSizes = "(min-width: 1200px) 380px, (min-width: 768px) calc(50vw - 1.875rem), calc(100vw - 2.5rem)",
}: {
  post: BlogPost;
  locale: string;
  dict: Dictionary;
  imageSizes?: string;
}) {
  const copy = localizeBlogPost(post, locale);
  const dest = getDestination(post.destination);
  const [from, to] = dest?.heroGradient ?? ["#0F6E6E", "#1C2430"];
  const countryNames = blogCountries(post).flatMap((slug) => {
    const place = getDestination(slug);
    if (!place) return [];
    const name = pick(place.name, locale);
    return name ? [name] : [];
  });
  const categoryLabel = formatBlogCategoryLabel(copy.category, dict);
  const readingLabel = dict.blog.readingTime.replace(
    "{minutes}",
    String(copy.readingTimeMinutes || 8),
  );

  return (
    <article className="atlas-card group relative flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <div
        className="relative aspect-[16/9] overflow-hidden [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.02]"
        style={{ backgroundImage: `linear-gradient(150deg, ${from}, ${to})` }}
      >
        {copy.heroImage?.src ? (
          <CoverImage
            src={copy.heroImage.src}
            alt={imageAlt(copy.heroImage, locale) || copy.title}
            width={copy.heroImage.width}
            height={copy.heroImage.height}
            sizes={imageSizes}
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />
        <div className="absolute left-4 right-4 top-3.5 flex items-center justify-between gap-2 text-xs font-semibold">
          <span className="truncate rounded-full bg-ink/65 px-3 py-1 text-white backdrop-blur-sm">
            {countryNames.join(" · ") || copy.destination}
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
              copy.category === "top-places"
                ? "border border-teal/30 bg-teal-soft text-teal"
                : copy.category === "seasonal"
                  ? "border border-line bg-cream text-sand-deep"
                  : "bg-teal-soft text-teal"
            }`}
          >
            {categoryLabel}
          </span>
          {copy.sections.some((s) => typeof s.rankNumber === "number") ? (
            <span className="text-xs font-medium text-muted">
              · {copy.sections.filter((s) => typeof s.rankNumber === "number").length} stops
            </span>
          ) : null}
        </div>
        <h3 className="mt-2.5 font-serif text-2xl leading-snug text-ink">
          <Link
            href={`/${locale}/blog/${copy.slug}/`}
            className="transition-colors group-hover:text-teal after:absolute after:inset-0 after:z-10 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-teal"
          >
            {copy.title}
          </Link>
        </h3>
        {copy.summary ? (
          <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted">{copy.summary}</p>
        ) : (
          <div className="flex-1" />
        )}
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5 text-sm">
          <time
            className="text-xs text-muted"
            dateTime={lastModified(copy.publishedAt, copy.updatedAt)}
          >
            {formatDisplayDate(lastModified(copy.publishedAt, copy.updatedAt), locale)}
          </time>
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
}
