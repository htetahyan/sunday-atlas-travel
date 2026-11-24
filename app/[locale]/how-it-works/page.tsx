import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageFaq } from "@/components/PageFaq";
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
    path: "/how-it-works/",
    title: dict.howItWorks.meta.title,
    description: dict.howItWorks.meta.description,
  });
}

export default async function HowItWorksPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  const howPage = getStaticPage("how-it-works");
  const pageFaqs = localizeFaqs(howPage.faqs, locale);
  const pageFaqTitle = localizeFaqTitle(howPage.faqTitle, locale) || dict.common.pageFaqTitle;

  return (
    <main id="main" tabIndex={-1}>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[
          { name: dict.nav.home, path: "/" },
          { name: dict.nav.howItWorks, path: "/how-it-works/" },
        ]}
      />
      <article className="mx-auto w-full max-w-3xl px-5 py-14 md:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
          {dict.howItWorks.eyebrow}
        </p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight text-ink sm:text-5xl">
          {dict.howItWorks.title}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">{dict.howItWorks.lede}</p>
        <ol className="mt-10 space-y-5">
          {dict.howItWorks.steps.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-line bg-card p-5 shadow-card">
              <p className="font-serif text-2xl text-teal">{String(index + 1).padStart(2, "0")}</p>
              <h2 className="mt-2 font-serif text-2xl text-ink">{step.title}</h2>
              <p className="mt-2 leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <h2 className="mt-14 font-serif text-3xl text-ink">{dict.howItWorks.stagesTitle}</h2>
        <ol className="mt-6 space-y-6 border-l border-line pl-6">
          {dict.howItWorks.stages.map((stage, index) => (
            <li key={stage.title} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[1.7rem] top-1.5 h-3 w-3 rounded-full bg-sand ring-4 ring-cream"
              />
              <p className="text-sm font-semibold text-sand-deep">{index + 1}</p>
              <h3 className="font-serif text-xl text-ink">{stage.title}</h3>
              <p className="mt-1 leading-relaxed text-muted">{stage.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-muted">{dict.howItWorks.closing}</p>
        <Link
          href={`/${locale}/contact/`}
          className="mt-8 inline-flex items-center justify-center rounded-full bg-teal px-5 py-3 text-sm font-semibold text-white hover:bg-teal-dark"
        >
          {dict.nav.planTrip}
        </Link>
        <PageFaq title={pageFaqTitle} items={pageFaqs} />
      </article>
    </main>
  );
}
