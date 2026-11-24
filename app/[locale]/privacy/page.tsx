import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProsePage } from "@/components/ProsePage";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";
import { contactEmail } from "@/lib/content";
import { buildPageMetadata } from "@/lib/metadata";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return buildPageMetadata({
    locale,
    path: "/privacy/",
    title: dict.privacy.meta.title,
    description: dict.privacy.meta.description,
  });
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  return (
    <>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[
          { name: dict.nav.home, path: "/" },
          { name: dict.nav.privacy, path: "/privacy/" },
        ]}
      />
      <ProsePage
        eyebrow={dict.privacy.eyebrow}
        title={dict.privacy.title}
        lede={dict.privacy.lede}
        lastUpdated={dict.legal.lastUpdated}
        sections={dict.privacy.sections}
        email={contactEmail()}
        emailPending={dict.contact.emailPending}
      />
    </>
  );
}
