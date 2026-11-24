import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageCard } from "@/components/Cards";
import { PackagesCatalog } from "@/components/PackagesCatalog";
import { PageFaq } from "@/components/PageFaq";
import { PageSections } from "@/components/PageSections";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/seo/JsonLd";
import { isLocale, isPartialLocale } from "@/i18n/config";
import { PartialLocaleNote } from "@/components/PartialLocaleNote";
import { getDictionary } from "@/i18n/getDictionary";
import {
  getPackageRegions,
  getPackages,
  getStaticPage,
  isTranslated,
  localizeFaqTitle,
  localizeFaqs,
  localizePageSections,
} from "@/lib/content";
import { buildPageMetadata } from "@/lib/metadata";
import { packageListSchema } from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return buildPageMetadata({
    locale,
    path: "/packages/",
    title: dict.packages.meta.title,
    description: dict.packages.meta.description,
  });
}

export default async function PackagesPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  const packages = getPackages(locale);
  const packagesPage = getStaticPage("packages");
  const pageFaqs = localizeFaqs(packagesPage.faqs, locale);
  const pageFaqTitle = localizeFaqTitle(packagesPage.faqTitle, locale) || dict.common.pageFaqTitle;
  const pageSections = localizePageSections(packagesPage.sections, locale);

  const regionMap = new Map<string, string>();
  const catalogItems = packages.map((travelPackage) => {
    const pkgRegions = getPackageRegions(travelPackage, locale);
    for (const region of pkgRegions) {
      if (!regionMap.has(region.key)) {
        regionMap.set(region.key, region.label);
      }
    }
    return {
      slug: travelPackage.slug,
      isDayTour: travelPackage.isDayTour,
      regionKeys: pkgRegions.map((region) => region.key),
      card: (
        <PackageCard
          travelPackage={travelPackage}
          locale={locale}
          dict={dict}
        />
      ),
    };
  });
  const regions = Array.from(regionMap.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <main id="main" tabIndex={-1}>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[
          { name: dict.nav.home, path: "/" },
          { name: dict.nav.packages, path: "/packages/" },
        ]}
      />
      {packages.length > 0 ? <JsonLd data={packageListSchema(packages, locale)} /> : null}
      <div className="mx-auto max-w-page px-5 py-14 md:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
          {dict.packages.eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl font-serif text-4xl tracking-tight text-ink sm:text-5xl">
          {dict.packages.title}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{dict.packages.lede}</p>
        {packages.some((travelPackage) => !isTranslated(travelPackage.summary, locale)) ? (
          <p className="mt-4 text-sm text-muted">{dict.contentNote}</p>
        ) : null}
        {isPartialLocale(locale) ? (
          <PartialLocaleNote
            locale={locale}
            dict={dict}
            kind="packages"
            empty={packages.length === 0}
            className="mt-10"
          />
        ) : null}
        {packages.length === 0 ? (
          isPartialLocale(locale) ? null : (
            <p className="mt-10 rounded-2xl border border-dashed border-line bg-card px-5 py-10 text-muted">
              {dict.empty.packages}
            </p>
          )
        ) : (
          <PackagesCatalog
            items={catalogItems}
            regions={regions}
            labels={dict.packages}
          />
        )}
        <PageSections sections={pageSections} />
        <PageFaq title={pageFaqTitle} items={pageFaqs} />
      </div>
    </main>
  );
}
