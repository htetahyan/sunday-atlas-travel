import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DestinationCard } from "@/components/Cards";
import { PageFaq } from "@/components/PageFaq";
import { PageSections } from "@/components/PageSections";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/seo/JsonLd";
import { isLocale, isPartialLocale } from "@/i18n/config";
import { PartialLocaleNote } from "@/components/PartialLocaleNote";
import { getDictionary } from "@/i18n/getDictionary";
import {
  getDestinations,
  getStaticPage,
  isTranslated,
  localizeFaqTitle,
  localizeFaqs,
  localizePageSections,
} from "@/lib/content";
import { buildPageMetadata } from "@/lib/metadata";
import { destinationListSchema } from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return buildPageMetadata({
    locale,
    path: "/destinations/",
    title: dict.destinations.meta.title,
    description: dict.destinations.meta.description,
  });
}

export default async function DestinationsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  const destinations = getDestinations(locale);
  const destinationsPage = getStaticPage("destinations");
  const pageFaqs = localizeFaqs(destinationsPage.faqs, locale);
  const pageFaqTitle = localizeFaqTitle(destinationsPage.faqTitle, locale) || dict.common.pageFaqTitle;
  const pageSections = localizePageSections(destinationsPage.sections, locale);

  return (
    <main id="main" tabIndex={-1}>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[
          { name: dict.nav.home, path: "/" },
          { name: dict.nav.destinations, path: "/destinations/" },
        ]}
      />
      {destinations.length > 0 ? <JsonLd data={destinationListSchema(destinations, locale)} /> : null}
      <div className="mx-auto max-w-page px-5 py-14 md:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
          {dict.destinations.eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl font-serif text-4xl tracking-tight text-ink sm:text-5xl">
          {dict.destinations.title}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{dict.destinations.lede}</p>
        {destinations.some((destination) => !isTranslated(destination.summary, locale)) ? (
          <p className="mt-4 text-sm text-muted">{dict.contentNote}</p>
        ) : null}
        {isPartialLocale(locale) ? (
          <PartialLocaleNote
            locale={locale}
            dict={dict}
            kind="destinations"
            empty={destinations.length === 0}
            className="mt-10"
          />
        ) : null}
        {destinations.length === 0 ? (
          isPartialLocale(locale) ? null : (
            <p className="mt-10 rounded-2xl border border-dashed border-line bg-card px-5 py-10 text-muted">
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
        <PageSections sections={pageSections} />
        <PageFaq title={pageFaqTitle} items={pageFaqs} />
      </div>
    </main>
  );
}
