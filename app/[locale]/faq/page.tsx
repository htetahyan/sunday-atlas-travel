import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";
import { PageSections } from "@/components/PageSections";
import { JsonLd } from "@/components/seo/JsonLd";
import { getStaticPage, localizePageSections } from "@/lib/content";
import { absoluteUrl, buildPageMetadata } from "@/lib/metadata";
import { breadcrumbSchema, faqPageSchema } from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return buildPageMetadata({
    locale,
    path: "/faq/",
    title: dict.faq.meta.title,
    description: dict.faq.meta.description,
  });
}

export default async function FaqPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  const pageSections = localizePageSections(getStaticPage("faq").sections, locale);

  return (
    <main id="main" tabIndex={-1}>
      <JsonLd
        data={[
          breadcrumbSchema(
            [
              { name: dict.nav.home, url: absoluteUrl(locale, "/") },
              { name: dict.nav.faq, url: absoluteUrl(locale, "/faq/") },
            ],
            locale,
          ),
          faqPageSchema(dict.faq.items),
        ]}
      />
      <article className="mx-auto w-full max-w-3xl px-5 py-14 md:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">{dict.faq.eyebrow}</p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight text-ink sm:text-5xl">{dict.faq.title}</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">{dict.faq.lede}</p>
        <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-card">
          {dict.faq.items.map((item) => (
            <details key={item.q} className="group px-5">
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 text-left font-medium text-ink">
                {item.q}
                <span aria-hidden="true" className="text-xl leading-none text-teal transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-4 leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
        <PageSections sections={pageSections} />
      </article>
    </main>
  );
}
