import Link from "next/link";
import type { Metadata } from "next";
import { BlogCard, DestinationCard, PackageCard } from "@/components/Cards";
import { CoverImage } from "@/components/CoverImage";
import { LatestStrip, StatsStrip, newThisWeekCount } from "@/components/LiveStrips";
import { PageFaq } from "@/components/PageFaq";
import { PageSections } from "@/components/PageSections";
import { TopoBackdrop } from "@/components/TopoBackdrop";
import { JsonLd } from "@/components/seo/JsonLd";
import { heroImage } from "@/config/images";
import { hasBlog, isLocale, isPartialLocale } from "@/i18n/config";
import { PartialLocaleNote } from "@/components/PartialLocaleNote";
import { getDictionary } from "@/i18n/getDictionary";
import {
  getDestinations,
  getFeaturedBlogPosts,
  getFeaturedPackages,
  getStaticPage,
  localizeFaqTitle,
  localizeFaqs,
  localizePageSections,
} from "@/lib/content";
import { buildPageMetadata } from "@/lib/metadata";
import { fill } from "@/lib/paths";
import { homeWebPageSchema, websiteSchema } from "@/lib/structured-data";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return buildPageMetadata({
    locale,
    path: "/",
    title: dict.home.meta.title,
    description: dict.home.meta.description,
    image: {
      src: heroImage.src,
      width: heroImage.width,
      height: heroImage.height,
      alt: dict.home.heroImageAlt,
    },
  });
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  const destinations = getDestinations(locale);
  const packages = getFeaturedPackages(locale);
  const blogPosts = getFeaturedBlogPosts(6, locale);
  const homePage = getStaticPage("home");
  const pageFaqs = localizeFaqs(homePage.faqs, locale);
  const pageFaqTitle = localizeFaqTitle(homePage.faqTitle, locale) || dict.common.pageFaqTitle;
  const pageSections = localizePageSections(homePage.sections, locale);
  const freshCount = hasBlog(locale) ? newThisWeekCount() : 0;

  return (
    <main id="main" tabIndex={-1}>
      <JsonLd data={websiteSchema()} />
      <JsonLd data={homeWebPageSchema(locale)} />
      <section className="relative overflow-hidden border-b border-line">
        <TopoBackdrop />
        <div className="relative mx-auto grid max-w-page items-center gap-10 px-5 py-16 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:py-24">
          <div>
            {freshCount > 0 ? (
              <Link
                href={`/${locale}/blog/`}
                className="btn-pop mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-card/90 px-3 py-1.5 text-xs font-semibold text-ink shadow-sm hover:border-teal hover:text-teal"
              >
                <span className="live-dot" aria-hidden="true" />
                {fill(dict.home.latest.newThisWeek, { count: freshCount })}
                <span aria-hidden="true" className="btn-arrow">→</span>
              </Link>
            ) : null}
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
              {dict.home.eyebrow}
            </p>
            <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-[1.08] tracking-tight text-ink sm:text-5xl md:text-6xl">
              {dict.home.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">{dict.home.subtitle}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/${locale}/contact/`}
                className="btn-pop btn-shine inline-flex items-center justify-center gap-2 rounded-full bg-teal px-5 py-3 text-sm font-semibold text-white shadow-card hover:bg-teal-dark"
              >
                {dict.nav.planTrip}
                <svg viewBox="0 0 24 24" className="btn-arrow h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <Link
                href={`/${locale}/packages/`}
                className="btn-pop inline-flex items-center justify-center rounded-full border border-line bg-card px-5 py-3 text-sm font-semibold text-ink hover:border-teal hover:text-teal"
              >
                {dict.home.secondaryCta}
              </Link>
            </div>
          </div>
          <div
            className="hero-media relative aspect-[3/2] overflow-hidden rounded-2xl shadow-card"
            style={{ backgroundImage: "linear-gradient(150deg, #0F6E6E, #1C2430)" }}
          >
            <CoverImage
              src={heroImage.src}
              alt={dict.home.heroImageAlt}
              width={heroImage.width}
              height={heroImage.height}
              sizes="(min-width: 1200px) 476px, (min-width: 768px) calc(42.5vw - 2.125rem), calc(100vw - 2.5rem)"
              priority
            />
          </div>
        </div>
      </section>

      {hasBlog(locale) ? <LatestStrip locale={locale} dict={dict} /> : null}
      {hasBlog(locale) ? <StatsStrip dict={dict} /> : null}

      <section className="mx-auto max-w-page px-5 py-16 md:py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
          {dict.home.why.eyebrow}
        </p>
        <h2 data-reveal className="mt-3 max-w-2xl font-serif text-3xl tracking-tight text-ink sm:text-4xl">
          {dict.home.why.title}
        </h2>
        <p className="mt-4 max-w-2xl text-muted">{dict.home.why.lede}</p>
        <div data-reveal-group className="mt-10 grid gap-5 sm:grid-cols-2">
          {dict.home.why.cards.map((card) => (
            <article key={card.title} className="atlas-card rounded-2xl border border-line bg-card p-6 shadow-card">
              <h3 className="font-serif text-2xl text-ink">{card.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-card/60">
        <div className="mx-auto max-w-page px-5 py-16 md:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
            {dict.home.destinations.eyebrow}
          </p>
          <h2 className="mt-3 font-serif text-3xl tracking-tight text-ink sm:text-4xl">
            {dict.home.destinations.title}
          </h2>
          <p className="mt-4 max-w-2xl text-muted">{dict.home.destinations.lede}</p>
          {isPartialLocale(locale) ? (
            <PartialLocaleNote
              locale={locale}
              dict={dict}
              kind="destinations"
              empty={destinations.length === 0}
              className="mt-8"
            />
          ) : null}
          {destinations.length === 0 ? (
            isPartialLocale(locale) ? null : (
              <p className="mt-8 rounded-2xl border border-dashed border-line bg-cream px-5 py-8 text-muted">
                {dict.empty.destinations}
              </p>
            )
          ) : (
            <div data-reveal-group className="mt-10 grid gap-5 md:grid-cols-2">
              {destinations.map((destination) => (
                <DestinationCard
                  key={destination.slug}
                  destination={destination}
                  locale={locale}
                  dict={dict}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-page px-5 py-16 md:py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
          {dict.home.packages.eyebrow}
        </p>
        <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h2 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
              {dict.home.packages.title}
            </h2>
            <p className="mt-4 max-w-2xl text-muted">{dict.home.packages.lede}</p>
          </div>
          <Link
            href={`/${locale}/packages/`}
            className="text-sm font-semibold text-teal underline-offset-4 hover:underline"
          >
            {dict.cta.browsePackages}
          </Link>
        </div>
        {isPartialLocale(locale) ? (
          <PartialLocaleNote
            locale={locale}
            dict={dict}
            kind="packages"
            empty={packages.length === 0}
            className="mt-8"
          />
        ) : null}
        {packages.length === 0 ? (
          isPartialLocale(locale) ? null : (
            <p className="mt-8 rounded-2xl border border-dashed border-line bg-card px-5 py-8 text-muted">
              {dict.empty.packages}
            </p>
          )
        ) : (
          <div data-reveal-group className="mt-10 grid gap-5 md:grid-cols-2">
            {packages.map((travelPackage) => (
              <PackageCard
                key={travelPackage.slug}
                travelPackage={travelPackage}
                locale={locale}
                dict={dict}
              />
            ))}
          </div>
        )}
        <PageSections sections={pageSections} />
      </section>

      {blogPosts.length > 0 ? (
        <section className="border-t border-line bg-card/60">
          <div className="mx-auto max-w-page px-5 py-16 md:py-24">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
              {dict.home.blog.eyebrow}
            </p>
            <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <h2 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
                  {dict.home.blog.title}
                </h2>
                <p className="mt-4 max-w-2xl text-muted">{dict.home.blog.lede}</p>
              </div>
              <Link
                href={`/${locale}/blog/`}
                className="text-sm font-semibold text-teal underline-offset-4 hover:underline"
              >
                {dict.cta.browseGuides}
              </Link>
            </div>
            <div data-reveal-group className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {blogPosts.map((post) => (
                <BlogCard key={post.slug} post={post} locale={locale} dict={dict} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="border-t border-line bg-teal-soft/40">
        <div className="mx-auto max-w-page px-5 py-16 md:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
            {dict.home.how.eyebrow}
          </p>
          <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="font-serif text-3xl tracking-tight text-ink sm:text-4xl">
                {dict.home.how.title}
              </h2>
              <p className="mt-4 max-w-2xl text-muted">{dict.home.how.lede}</p>
            </div>
            <Link href={`/${locale}/how-it-works/`} className="text-sm font-semibold text-teal underline-offset-4 hover:underline">
              {dict.cta.readHow}
            </Link>
          </div>
          <ol data-reveal-group className="mt-10 grid gap-5 md:grid-cols-4">
            {dict.howItWorks.steps.map((step, index) => (
              <li key={step.title} className="atlas-card rounded-2xl border border-line bg-card p-5 shadow-card">
                <p className="font-serif text-2xl text-teal">{String(index + 1).padStart(2, "0")}</p>
                <h3 className="mt-3 font-serif text-xl text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-page px-5 py-16 md:py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
          {dict.home.faq.eyebrow}
        </p>
        <h2 className="mt-3 font-serif text-3xl tracking-tight text-ink sm:text-4xl">{dict.home.faq.title}</h2>
        <p className="mt-4 max-w-2xl text-muted">{dict.home.faq.lede}</p>
        <div data-reveal className="mt-8 divide-y divide-line rounded-2xl border border-line bg-card">
          {dict.faq.items.slice(0, 4).map((item) => (
            <details key={item.q} className="group px-5">
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 font-medium text-ink">
                {item.q}
                <span aria-hidden="true" className="text-xl text-teal transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
        <Link href={`/${locale}/faq/`} className="mt-6 inline-flex text-sm font-semibold text-teal underline-offset-4 hover:underline">
          {dict.cta.readFaq}
        </Link>
      </section>

      {pageFaqs.length > 0 ? (
        <div className="mx-auto max-w-page px-5 pb-16 md:pb-24">
          <PageFaq title={pageFaqTitle} items={pageFaqs} />
        </div>
      ) : null}

      <section className="bg-teal text-white">
        <div className="mx-auto flex max-w-page flex-col items-start gap-6 px-5 py-16 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">{dict.cta.bandTitle}</h2>
            <p className="mt-3 text-white/95">{dict.cta.bandBody}</p>
          </div>
          <Link
            href={`/${locale}/contact/`}
            className="btn-pop btn-shine inline-flex items-center justify-center gap-2 rounded-full bg-cream px-5 py-3 text-sm font-semibold text-ink hover:bg-white"
          >
            {dict.cta.bandAction}
            <svg viewBox="0 0 24 24" className="btn-arrow h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </section>
    </main>
  );
}
