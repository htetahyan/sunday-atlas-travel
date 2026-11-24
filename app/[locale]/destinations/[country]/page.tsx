import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Gallery } from "@/components/gallery/Gallery";
import { JsonLd } from "@/components/seo/JsonLd";
import { BlogCard, PackageCard } from "@/components/Cards";
import { locales, isLocale, isPartialLocale } from "@/i18n/config";
import { PartialLocaleNote } from "@/components/PartialLocaleNote";
import { getDictionary } from "@/i18n/getDictionary";
import {
  destinationAvailableIn,
  getBlogPostsByDestination,
  getDestination,
  getDestinations,
  getPackagesByDestination,
  imageAlt,
  isTranslated,
  localizeDestination,
} from "@/lib/content";
import { absoluteUrl, buildPageMetadata, descriptionFromSummary, heroOpenGraphImage } from "@/lib/metadata";
import { breadcrumbSchema, destinationPackagesSchema, faqPageSchema, touristDestinationSchema } from "@/lib/structured-data";
import { fill } from "@/lib/paths";
import { destinationAnswerLine } from "@/lib/answer-lines";

type Props = { params: Promise<{ locale: string; country: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.flatMap((locale) =>
    getDestinations()
      .filter((destination) => destinationAvailableIn(destination, locale))
      .map((destination) => ({ locale, country: destination.slug })),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, country } = await params;
  if (!isLocale(locale)) return {};
  const destination = getDestination(country);
  const dict = await getDictionary(locale);
  if (!destination) {
    return buildPageMetadata({
      locale,
      path: `/destinations/${country}/`,
      title: dict.destinations.meta.title,
      description: dict.destinations.meta.description,
    });
  }
  const copy = localizeDestination(destination, locale);
  const alt = imageAlt(destination.image, locale) || copy.name;
  return buildPageMetadata({
    locale,
    path: `/destinations/${destination.slug}/`,
    title: fill(dict.destinations.detail.metaTitle, { name: copy.name }),
    description: descriptionFromSummary(copy.summary, dict.destinations.detail.emptySummary),
    image: heroOpenGraphImage(destination.image?.src, alt),
  });
}

export default async function DestinationPage({ params }: Props) {
  const { locale, country } = await params;
  if (!isLocale(locale)) notFound();
  const destination = getDestination(country);
  if (!destination) notFound();
  const dict = await getDictionary(locale);
  const copy = localizeDestination(destination, locale);
  const packages = getPackagesByDestination(destination.slug, locale);
  const allPackageCount = getPackagesByDestination(destination.slug).length;
  const blogPosts = getBlogPostsByDestination(destination.slug, locale);
  const answerLine = destinationAnswerLine(destination, locale, dict);
  const showContentNote =
    !isTranslated(destination.summary, locale) ||
    packages.some((travelPackage) => !isTranslated(travelPackage.summary, locale));
  const [from, to] = copy.heroGradient;
  const heroAlt = imageAlt(destination.image, locale) || copy.name;
  const photos = [
    ...(destination.image?.src
      ? [
          {
            src: destination.image.src,
            width: destination.image.width,
            height: destination.image.height,
            alt: heroAlt,
          },
        ]
      : []),
    ...copy.gallery,
  ];

  return (
    <main id="main" tabIndex={-1}>
      <JsonLd
        data={[
          breadcrumbSchema(
            [
              { name: dict.nav.home, url: absoluteUrl(locale, "/") },
              { name: dict.nav.destinations, url: absoluteUrl(locale, "/destinations/") },
              {
                name: copy.name,
                url: absoluteUrl(locale, `/destinations/${destination.slug}/`),
              },
            ],
            locale,
          ),
          touristDestinationSchema(destination, locale),
          ...(packages.length > 0 ? [destinationPackagesSchema(destination, packages, locale)] : []),
          ...(copy.faqs.length > 0 ? [faqPageSchema(copy.faqs)] : []),
        ]}
      />
      <div className="mx-auto max-w-page px-5 pt-5 lg:pt-3">
        <Breadcrumbs
          label={dict.breadcrumb.label}
          items={[
            { label: dict.nav.home, href: `/${locale}/` },
            { label: dict.nav.destinations, href: `/${locale}/destinations/` },
            { label: copy.name },
          ]}
        />
      </div>
      <section
        className="relative mt-4 text-white lg:mt-3"
        style={{ backgroundImage: `linear-gradient(145deg, ${from}, ${to})` }}
      >
        <div className="relative mx-auto max-w-page px-5 pb-16 pt-8 md:pb-16 md:pt-10 lg:pb-12 lg:pt-6">
          {copy.region ? <p className="text-sm text-white/90">{copy.region}</p> : null}
          <h1 className="mt-1.5 font-serif text-4xl tracking-tight sm:text-5xl">
            {copy.headings.h1 || copy.name}
          </h1>
          {answerLine ? (
            <p data-answer-line className="mt-3 max-w-3xl text-base font-medium leading-snug text-white/95">
              {answerLine}
            </p>
          ) : null}
        </div>
      </section>
      <div className="mx-auto max-w-page px-5">
        {photos.length > 0 ? (
          <div className="relative z-10 -mt-10 md:-mt-10 lg:-mt-8">
            <Gallery images={photos} labels={dict.gallery} />
          </div>
        ) : null}
      </div>
      <div className="mx-auto grid max-w-page gap-10 px-5 py-14 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article>
          {showContentNote ? <p className="mb-4 text-sm text-muted">{dict.contentNote}</p> : null}
          {copy.intro ? <p className="text-lg leading-relaxed text-ink">{copy.intro}</p> : null}
          {copy.summary ? (
            <p className={`${copy.intro ? "mt-4" : ""} text-lg leading-relaxed text-ink`}>{copy.summary}</p>
          ) : null}
          {copy.bestSeasons.length > 0 ? (
            <>
              <h2 className="mt-10 font-serif text-2xl text-ink">
                {copy.headings.seasons || dict.destinations.seasons}
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {copy.bestSeasons.map((season) => (
                  <li key={season} className="rounded-full border border-line bg-card px-3 py-1 text-sm text-ink">
                    {season}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {copy.highlights.length > 0 ? (
            <>
              <h2 className="mt-10 font-serif text-2xl text-ink">
                {copy.headings.highlights || dict.destinations.highlights}
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
                {copy.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          {copy.visaNote ? (
            <aside className="mt-10 rounded-2xl border border-teal/30 bg-teal-soft px-5 py-4">
              <h2 className="font-serif text-xl text-ink">{dict.destinations.visaTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink">{copy.visaNote}</p>
            </aside>
          ) : null}
          {copy.faqs.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-serif text-2xl text-ink">
                {copy.headings.faq || dict.destinations.faqTitle}
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
          <h2 className="mt-12 font-serif text-3xl text-ink">
            {copy.headings.packages || dict.destinations.packagesTitle}
          </h2>
          {isPartialLocale(locale) && (packages.length === 0 || packages.length < allPackageCount) ? (
            <PartialLocaleNote
              locale={locale}
              dict={dict}
              kind="packages"
              empty={packages.length === 0}
              className="mt-4"
            />
          ) : null}
          {packages.length === 0 ? (
            isPartialLocale(locale) ? null : <p className="mt-4 text-muted">{dict.empty.countryPackages}</p>
          ) : (
            <div className="mt-6 grid gap-5">
              {packages.map((travelPackage) => (
                <PackageCard
                  key={travelPackage.slug}
                  travelPackage={travelPackage}
                  locale={locale}
                  dict={dict}
                  imageSizes="(min-width: 1200px) 840px, (min-width: 1024px) calc(100vw - 22.5rem), calc(100vw - 2.5rem)"
                />
              ))}
            </div>
          )}
          {blogPosts.length > 0 ? (
            <section className="mt-12 border-t border-line pt-10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">
                    {dict.blog.eyebrow}
                  </p>
                  <h2 className="mt-2 font-serif text-3xl text-ink">
                    {dict.blog.relatedGuidesTitle}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-muted">
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
              <div data-reveal-group className="mt-6 grid gap-5 md:grid-cols-2">
                {blogPosts.map((post) => (
                  <BlogCard key={post.slug} post={post} locale={locale} dict={dict} />
                ))}
              </div>
            </section>
          ) : null}
        </article>
        <aside className="h-fit rounded-2xl border border-line bg-card p-5 shadow-card lg:sticky lg:top-24">
          <h2 className="font-serif text-2xl text-ink">
            {fill(dict.destinations.inquireTitle, { name: copy.name })}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">{dict.destinations.inquireBody}</p>
          <a
            rel="nofollow"
            href={
              packages[0]
                ? `/${locale}/contact?package=${packages[0].slug}`
                : `/${locale}/contact/`
            }
            className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-teal px-4 py-3 text-sm font-semibold text-white hover:bg-teal-dark"
          >
            {dict.cta.inquire}
          </a>
        </aside>
      </div>
    </main>
  );
}
