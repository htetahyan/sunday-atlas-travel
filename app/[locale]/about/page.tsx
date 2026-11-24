import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageFaq } from "@/components/PageFaq";
import { ProsePage } from "@/components/ProsePage";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";
import { getStaticPage, localizeFaqTitle, localizeFaqs } from "@/lib/content";
import { buildPageMetadata } from "@/lib/metadata";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return buildPageMetadata({
    locale,
    path: "/about/",
    title: dict.about.meta.title,
    description: dict.about.meta.description,
  });
}

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  const aboutPage = getStaticPage("about");
  const pageFaqs = localizeFaqs(aboutPage.faqs, locale);
  const pageFaqTitle = localizeFaqTitle(aboutPage.faqTitle, locale) || dict.common.pageFaqTitle;
  return (
    <>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[
          { name: dict.nav.home, path: "/" },
          { name: dict.nav.about, path: "/about/" },
        ]}
      />
      <ProsePage
        eyebrow={dict.about.eyebrow}
        title={dict.about.title}
        lede={dict.about.lede}
        sections={dict.about.sections}
      >
        <PageFaq title={pageFaqTitle} items={pageFaqs} />
      </ProsePage>
    </>
  );
}
