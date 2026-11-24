import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BlogCard, PackageCard } from "@/components/Cards";
import { CoverImage } from "@/components/CoverImage";
import { Gallery } from "@/components/gallery/Gallery";
import { JsonLd } from "@/components/seo/JsonLd";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/getDictionary";
import {
  destinationAvailableIn,
  packageAvailableIn,
  formatPackageDuration,
  formatStoredPrice,
  getBlogPostsByDestination,
  getBlogPostsForPackage,
  getDestination,
  getPackage,
  getPackages,
  imageAlt,
  isTranslated,
  localizePackage,
  packageCountries,
  pick,
} from "@/lib/content";
import {
  absoluteUrl,
  buildPageMetadata,
  descriptionFromSummary,
  heroOpenGraphImage,
  packagePageTitle,
} from "@/lib/metadata";
import { breadcrumbSchema, faqPageSchema, packageWebPageSchema, touristTripSchema } from "@/lib/structured-data";
import { fill } from "@/lib/paths";
import { compactPriceTable, packageAnswerLine } from "@/lib/answer-lines";

type Props = { params: Promise<{ locale: string; slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.flatMap((locale) =>
    getPackages(locale).map((travelPackage) => ({ locale, slug: travelPackage.slug })),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const travelPackage = getPackage(slug);
  const dict = await getDictionary(locale);
  if (!travelPackage) {
    return buildPageMetadata({
      locale,
      path: `/packages/${slug}/`,
      title: dict.packages.meta.title,
      description: dict.packages.meta.description,
    });
  }
  const copy = localizePackage(travelPackage, locale);
  const alt = imageAlt(travelPackage.image, locale) || copy.title;
  return buildPageMetadata({
    locale,
    path: `/packages/${travelPackage.slug}/`,
    title: packagePageTitle(
      locale,
      { title: dict.packages.detail.metaTitle, fallbackTitle: dict.packages.detail.fallbackTitle },
      copy.title,
      pick(travelPackage.title, "en"),
    ),
    description: descriptionFromSummary(copy.summary, dict.packages.detail.emptySummary),
    image: heroOpenGraphImage(travelPackage.image?.src, alt),
  });
}

export default async function PackagePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const travelPackage = getPackage(slug);
  if (!travelPackage) notFound();
  const dict = await getDictionary(locale);
  const copy = localizePackage(travelPackage, locale);
  const destination = getDestination(travelPackage.destination);
  const countries = packageCountries(travelPackage).flatMap((slug) => {
    const place = getDestination(slug);
    if (!place) return [];
    const name = pick(place.name, locale);
    if (!name) return [];
    return [{ slug: place.slug, name, linked: destinationAvailableIn(place, locale) }];
  });
  const showContentNote =
    !isTranslated(travelPackage.summary, locale) ||
    travelPackage.itinerary.some((day) => !isTranslated(day.description, locale));
  const priceLabel = copy.fromLabel || dict.packages.priceOnRequest;
  const durationLabel = formatPackageDuration(copy.durationDays, copy.nights, dict.packages);
  const answerLine = packageAnswerLine(travelPackage, locale, dict);
  const compactPrices = compactPriceTable(travelPackage, locale, dict);
  const addOnPackages = travelPackage.addOns.flatMap((addOnSlug) => {
    if (addOnSlug === travelPackage.slug) return [];
    const related = getPackage(addOnSlug);
    return related && packageAvailableIn(related, locale) ? [related] : [];
  });
  const currentCountrySlugs = new Set(packageCountries(travelPackage));
  const relatedPackages =
    addOnPackages.length === 0
      ? getPackages(locale)
          .filter(
            (candidate) =>
              candidate.slug !== travelPackage.slug &&
              packageCountries(candidate).some((countrySlug) => currentCountrySlugs.has(countrySlug)),
          )
          .slice(0, 3)
      : [];
  const directBlogs = getBlogPostsForPackage(travelPackage.slug, locale);
  const destBlogs = getBlogPostsByDestination(travelPackage.destination, locale);
  const relatedBlogPosts = Array.from(
    new Map([...directBlogs, ...destBlogs].map((b) => [b.slug, b])).values(),
  ).slice(0, 3);
  const heroAlt = imageAlt(copy.image, locale) || copy.title;
  const photos = [
    ...(copy.image?.src
      ? [
          {
            src: copy.image.src,
            width: copy.image.width,
            height: copy.image.height,
            alt: heroAlt,
          },
        ]
      : []),
    ...copy.gallery,
  ];

  return (
    <main id="main" tabIndex={-1} className="min-w-0">
      <JsonLd
        data={[
          breadcrumbSchema(
            [
              { name: dict.nav.home, url: absoluteUrl(locale, "/") },
              { name: dict.nav.packages, url: absoluteUrl(locale, "/packages/") },
              {
                name: copy.title,
                url: absoluteUrl(locale, `/packages/${copy.slug}/`),
              },
            ],
            locale,
          ),
          packageWebPageSchema(travelPackage, locale),
          touristTripSchema(travelPackage, destination, locale),
          ...(copy.faqs.length > 0 ? [faqPageSchema(copy.faqs)] : []),
        ]}
      />
      <div className="border-b border-line bg-card">
        <div className="mx-auto max-w-page px-5 pb-5 pt-4 lg:pb-2 lg:pt-3">
          <Breadcrumbs
            label={dict.breadcrumb.label}
            items={[
              { label: dict.nav.home, href: `/${locale}/` },
              { label: dict.nav.packages, href: `/${locale}/packages/` },
              { label: copy.title },
            ]}
          />
          {photos.length > 0 ? (
            <div className="mt-3 lg:mt-2.5">
              <Gallery images={photos} labels={dict.gallery} />
            </div>
          ) : null}
          {copy.isDayTour ? (
            <p className="mt-3">
              <span className="inline-flex items-center rounded-full border border-teal/30 bg-teal-soft px-2.5 py-0.5 text-xs font-semibold text-teal">
                {dict.packages.dayTourBadge}
              </span>
            </p>
          ) : null}
          <h1 className="mt-2.5 max-w-3xl font-serif text-3xl tracking-tight text-ink sm:text-4xl lg:mt-1.5">
            {copy.headings.h1 || copy.title}
          </h1>
          {answerLine ? (
            <p data-answer-line className="mt-2 max-w-2xl text-base font-medium leading-snug text-ink">
              {answerLine}
            </p>
          ) : null}
          {copy.intro ? <p className="mt-2 max-w-2xl text-lg leading-relaxed text-ink">{copy.intro}</p> : null}
          {copy.summary ? (
            <p
              className={`${copy.intro ? "mt-4" : "mt-2 lg:mt-1.5"} max-w-2xl text-base leading-snug text-muted sm:text-lg lg:text-base lg:leading-snug`}
            >
              {copy.summary}
            </p>
          ) : null}
          {showContentNote ? <p className="mt-2 text-sm text-muted">{dict.contentNote}</p> : null}
        </div>
      </div>

      <div className="mx-auto grid min-w-0 max-w-page grid-cols-[minmax(0,1fr)] gap-10 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8 lg:pb-10 lg:pt-2">
        <article className="min-w-0">
          <h2 className="font-serif text-2xl text-ink">{copy.headings.facts || dict.packages.facts}</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {countries.length > 0 ? (
              <div className="rounded-2xl border border-line bg-card p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sand-deep">
                  {dict.packages.countries}
                </dt>
                <dd className="mt-1 text-ink">
                  <ul className="flex flex-wrap gap-x-3 gap-y-1">
                    {countries.map((place) => (
                      <li key={place.slug}>
                        {place.linked ? (
                          <Link
                            href={`/${locale}/destinations/${place.slug}/`}
                            className="underline-offset-4 hover:underline"
                          >
                            {place.name}
                          </Link>
                        ) : (
                          place.name
                        )}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {copy.durationDays > 0 ? (
              <div className="rounded-2xl border border-line bg-card p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sand-deep">
                  {dict.packages.length}
                </dt>
                <dd className="mt-1 text-ink">{durationLabel}</dd>
              </div>
            ) : null}
            {copy.maxGroupSize != null && copy.maxGroupSize > 0 ? (
              <div className="rounded-2xl border border-line bg-card p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sand-deep">
                  {dict.packages.groupSize}
                </dt>
                <dd className="mt-1 text-ink">{fill(dict.packages.groupMax, { n: copy.maxGroupSize })}</dd>
              </div>
            ) : null}
            {copy.seasonNote ? (
              <div className="rounded-2xl border border-line bg-card p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sand-deep">
                  {dict.packages.season}
                </dt>
                <dd className="mt-1 text-ink">{copy.seasonNote}</dd>
              </div>
            ) : null}
            {copy.style ? (
              <div className="rounded-2xl border border-line bg-card p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sand-deep">
                  {dict.packages.style}
                </dt>
                <dd className="mt-1 text-ink">{copy.style}</dd>
              </div>
            ) : null}
            <div className="rounded-2xl border border-line bg-card p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-sand-deep">
                {dict.packages.price}
              </dt>
              <dd className="mt-1 text-ink">{priceLabel}</dd>
            </div>
          </dl>
          {compactPrices ? <CompactPrices table={compactPrices} dict={dict} rowHeader={copy.priceTable?.rowHeader} /> : null}

          {copy.itinerary.length > 0 ? (
            <>
              <h2 className="mt-12 font-serif text-3xl text-ink">
                {copy.headings.itinerary || dict.packages.itinerary}
              </h2>
              <ol className="mt-6 space-y-8 border-l border-line pl-6">
                {copy.itinerary.map((day) => (
                  <li key={day.day} className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[1.7rem] top-1.5 h-3 w-3 rounded-full bg-teal ring-4 ring-cream"
                    />
                    <p className="text-sm font-semibold text-teal">
                      {fill(dict.packages.dayLabel, { day: day.day })}
                    </p>
                    {day.title ? <h3 className="mt-1 font-serif text-2xl text-ink">{day.title}</h3> : null}
                    {day.description ? (
                      <p className="mt-2 leading-relaxed text-muted">{day.description}</p>
                    ) : null}
                    {day.meals ? (
                      <p className="mt-2 text-sm text-muted">
                        <span className="font-semibold text-ink">{dict.packages.meals}: </span>
                        {day.meals}
                      </p>
                    ) : null}
                    {day.image ? (
                      <figure className="mt-4 w-full max-w-md">
                        <div className="relative aspect-[3/2] overflow-hidden rounded-xl bg-line">
                          <CoverImage
                            src={day.image.src}
                            alt={day.image.alt}
                            width={day.image.width}
                            height={day.image.height}
                            sizes="(min-width: 768px) 28rem, calc(100vw - 2.5rem)"
                          />
                        </div>
                        {day.image.alt ? (
                          <figcaption className="mt-2 text-sm text-muted">{day.image.alt}</figcaption>
                        ) : null}
                      </figure>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          {copy.changeNote ? (
            <p
              className={`${copy.itinerary.length > 0 ? "mt-6" : "mt-12"} text-sm leading-relaxed text-muted`}
            >
              {copy.changeNote}
            </p>
          ) : null}

          {copy.priceTable ? <PriceTableSection table={copy.priceTable} dict={dict} headings={copy.headings.prices} /> : null}

          {addOnPackages.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-serif text-2xl text-ink">
                {copy.headings.addOns || dict.packages.addOnsTitle}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{dict.packages.addOnsLede}</p>
              <div data-reveal-group className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {addOnPackages.map((item) => (
                  <PackageCard
                    key={item.slug}
                    travelPackage={item}
                    locale={locale}
                    dict={dict}
                    compact
                    imageSizes="(min-width: 1024px) 260px, (min-width: 640px) calc(50vw - 2.5rem), calc(100vw - 2.5rem)"
                  />
                ))}
              </div>
            </section>
          ) : relatedPackages.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-serif text-2xl text-ink">{dict.packages.relatedTitle}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{dict.packages.relatedLede}</p>
              <div data-reveal-group className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {relatedPackages.map((item) => (
                  <PackageCard
                    key={item.slug}
                    travelPackage={item}
                    locale={locale}
                    dict={dict}
                    compact
                    imageSizes="(min-width: 1024px) 260px, (min-width: 640px) calc(50vw - 2.5rem), calc(100vw - 2.5rem)"
                  />
                ))}
              </div>
            </section>
          ) : null}

          {copy.included.length > 0 || copy.notIncluded.length > 0 ? (
            <div className="mt-12 grid gap-8 md:grid-cols-2">
              {copy.included.length > 0 ? (
                <section>
                  <h2 className="font-serif text-2xl text-ink">
                    {copy.headings.included || dict.packages.included}
                  </h2>
                  <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
                    {copy.included.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span aria-hidden="true" className="mt-0.5 text-teal">
                          ✓
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  {copy.trainNote ? (
                    <p className="mt-3 text-sm leading-relaxed text-muted">{copy.trainNote}</p>
                  ) : null}
                </section>
              ) : null}
              {copy.notIncluded.length > 0 ? (
                <section>
                  <h2 className="font-serif text-2xl text-ink">
                    {copy.headings.notIncluded || dict.packages.notIncluded}
                  </h2>
                  <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
                    {copy.notIncluded.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span aria-hidden="true" className="text-sand-deep">
                          –
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
          {copy.included.length === 0 && copy.trainNote ? (
            <p className="mt-12 text-sm leading-relaxed text-muted">{copy.trainNote}</p>
          ) : null}

          {copy.hotels.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-serif text-2xl text-ink">
                {copy.headings.hotels || dict.packages.hotelsTitle}
              </h2>
              <div className="mt-4 min-w-0 max-w-full overflow-x-auto rounded-2xl border border-line bg-card">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="px-4 py-3 font-semibold text-ink">
                        {dict.packages.city}
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold text-ink">
                        {dict.packages.hotelStandard}
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold text-ink">
                        {dict.packages.hotelSuperior}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {copy.hotels.map((stay, index) => (
                      <tr key={`${stay.city}-${index}`} className="border-b border-line last:border-0">
                        <th scope="row" className="px-4 py-3 text-left font-medium text-ink">
                          {stay.city}
                        </th>
                        <td className="px-4 py-3 text-muted">{stay.standard}</td>
                        <td className="px-4 py-3 text-muted">{stay.superior}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {copy.vehicles.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-serif text-2xl text-ink">
                {copy.headings.vehicles || dict.packages.vehiclesTitle}
              </h2>
              <div className="mt-4 min-w-0 max-w-full overflow-x-auto rounded-2xl border border-line bg-card">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="px-4 py-3 font-semibold text-ink">
                        {dict.packages.groupSize}
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold text-ink">
                        {dict.packages.vehicle}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {copy.vehicles.map((item, index) => (
                      <tr key={`${item.group}-${index}`} className="border-b border-line last:border-0">
                        <th scope="row" className="px-4 py-3 text-left font-medium text-ink">
                          {item.group}
                        </th>
                        <td className="px-4 py-3 text-muted">{item.vehicle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {copy.faqs.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-serif text-2xl text-ink">
                {copy.headings.faq || dict.packages.faqTitle}
              </h2>
              <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-card">
                {copy.faqs.map((item) => (
                  <details key={item.q} className="group px-5">
                    <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 font-medium text-ink">
                      {item.q}
                      <span aria-hidden="true" className="text-xl text-teal group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <p className="pb-4 text-sm leading-relaxed text-muted">{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          {relatedBlogPosts.length > 0 ? (
            <section className="mt-12 border-t border-line pt-10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">
                    {dict.blog.eyebrow}
                  </p>
                  <h2 className="mt-2 font-serif text-2xl text-ink">
                    {dict.blog.relatedGuidesTitle}
                  </h2>
                  <p className="mt-1.5 max-w-2xl text-sm text-muted">
                    {dict.blog.relatedGuidesLede}
                  </p>
                </div>
                <Link
                  href={`/${locale}/blog/`}
                  className="text-sm font-semibold text-teal hover:underline"
                >
                  {dict.cta.browseGuides} →
                </Link>
              </div>
              <div data-reveal-group className="mt-5 grid gap-5 md:grid-cols-2">
                {relatedBlogPosts.map((post) => (
                  <BlogCard key={post.slug} post={post} locale={locale} dict={dict} />
                ))}
              </div>
            </section>
          ) : null}
        </article>

        <aside className="h-fit min-w-0 rounded-2xl border border-line bg-card p-5 shadow-card lg:sticky lg:top-28">
          <h2 className="font-serif text-2xl text-ink">{dict.packages.inquireTitle}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">{dict.packages.inquireBody}</p>
          <p className="mt-3 text-sm font-semibold text-ink">{priceLabel}</p>
          {copy.priceNote ? <p className="mt-1 text-sm text-muted">{copy.priceNote}</p> : null}
          <a
            rel="nofollow"
            href={`/${locale}/contact?package=${copy.slug}`}
            className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-teal px-4 py-3 text-sm font-semibold text-white hover:bg-teal-dark"
          >
            {dict.cta.inquire}
          </a>
        </aside>
      </div>
    </main>
  );
}

/** Short per-person price grid for groups of 1, 2, 4 and 6, right under "At a glance". */
function CompactPrices({
  table,
  dict,
  rowHeader,
}: {
  table: NonNullable<ReturnType<typeof compactPriceTable>>;
  dict: Dictionary;
  rowHeader?: "hotels" | "tourType" | "option";
}) {
  const cell = "whitespace-nowrap px-3 py-2 tabular-nums";
  return (
    <section className="mt-6" aria-labelledby="compact-prices-title">
      <h3 id="compact-prices-title" className="text-sm font-semibold uppercase tracking-wide text-sand-deep">
        {dict.answer.compactTitle}
      </h3>
      <div className="mt-2 min-w-0 max-w-full overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full text-left text-sm">
          <caption className="px-3 pb-1 pt-3 text-left text-xs text-muted">{dict.answer.compactCaption}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 font-semibold text-ink">
                {rowHeader === "hotels"
                  ? dict.packages.hotelClass
                  : rowHeader === "option"
                    ? dict.packages.tierOption
                    : dict.packages.tierTourType}
              </th>
              {table.columns.map((column) => (
                <th key={column.label} scope="col" className={`${cell} font-semibold text-ink`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-2 font-medium leading-snug text-ink">
                  {row.label}
                </th>
                {row.prices.map((price, i) => (
                  <td key={i} className={`${cell} text-muted`}>
                    {price}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">{dict.answer.compactNote}</p>
    </section>
  );
}

type PriceTableCopy = NonNullable<ReturnType<typeof localizePackage>["priceTable"]>;

function PriceTableSection({
  table,
  dict,
  headings,
}: {
  table: PriceTableCopy;
  dict: Dictionary;
  headings: string;
}) {
  const columnCount =
    table.groupSizes.length > 0
      ? table.groupSizes.length
      : table.rows.reduce((max, row) => Math.max(max, row.prices.length), 0);
  const showTable = columnCount > 0 || table.rows.length > 0;
  // At lg the table is fixed to the article column. Hotel + supplement take a
  // set share; group columns split the rest so a 5- or 6-size table still fits.
  const groupCol = columnCount > 0 ? `${((100 - 11.3 - 19.4) / columnCount).toFixed(4)}%` : "0%";
  const columnStyle = {
    "--price-group": groupCol,
  } as CSSProperties;
  const head =
    "whitespace-normal text-balance break-words px-4 py-3 align-bottom font-semibold leading-snug text-ink hyphens-auto lg:py-2";
  const rowLabel =
    "whitespace-normal px-4 py-3 text-left font-medium leading-snug text-ink lg:py-2";
  const amount = "whitespace-nowrap px-4 py-3 tabular-nums text-muted lg:py-2";
  // Middle columns stay at 3px. Outer edges get ~12px so labels and the
  // single-supplement column sit clear of the rounded wrapper at lg.
  const pad = "lg:px-[3px]";
  const padFirst = "lg:pl-3 lg:pr-[3px]";
  const padLast = "lg:pl-[3px] lg:pr-3";
  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl text-ink">{headings || dict.packages.pricesTitle}</h2>
      {showTable ? (
        <div className="mt-4 min-w-0 max-w-full overflow-x-auto rounded-2xl border border-line bg-card">
          <table
            className="w-full min-w-[40rem] text-left text-sm lg:min-w-0 lg:table-fixed"
            style={columnStyle}
          >
            {table.caption ? (
              <caption className="px-4 pb-2 pt-4 text-left text-sm text-muted lg:px-2">{table.caption}</caption>
            ) : null}
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={`${head} ${padFirst} lg:w-[11.3%]`}>
                  {table.rowHeader === "hotels"
                    ? dict.packages.hotelClass
                    : table.rowHeader === "option"
                      ? dict.packages.tierOption
                      : dict.packages.tierTourType}
                </th>
                {Array.from({ length: columnCount }, (_, index) => (
                  <th key={index} scope="col" className={`${head} ${pad} lg:w-[var(--price-group)]`}>
                    {table.groupSizes[index] ?? ""}
                  </th>
                ))}
                <th scope="col" className={`${head} ${padLast} lg:w-[19.4%]`}>
                  {dict.packages.singleSupplement}
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`${row.label}-${rowIndex}`} className="border-b border-line last:border-0">
                  <th scope="row" className={`${rowLabel} ${padFirst}`}>
                    {row.label}
                  </th>
                  {Array.from({ length: columnCount }, (_, index) => {
                    const price = row.prices[index];
                    return (
                      <td key={index} className={`${amount} ${pad}`}>
                        {typeof price === "number" && Number.isFinite(price) ? formatStoredPrice(price) : ""}
                      </td>
                    );
                  })}
                  <td
                    className={`${row.singleSupplement ? amount : "whitespace-normal break-words px-4 py-3 tabular-nums text-muted lg:py-2"} ${padLast}`}
                  >
                    {row.singleSupplement || dict.packages.onRequest}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {table.note ? <p className="mt-3 text-sm leading-relaxed text-muted">{table.note}</p> : null}
    </section>
  );
}
