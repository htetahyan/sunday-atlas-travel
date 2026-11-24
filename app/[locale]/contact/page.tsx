import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InquiryForm } from "@/components/InquiryForm";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";
import { contactEmail, getDestinations, getPackages, pick } from "@/lib/content";
import { buildPageMetadata } from "@/lib/metadata";
import { fill } from "@/lib/paths";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return buildPageMetadata({
    locale,
    path: "/contact/",
    title: dict.contact.meta.title,
    description: dict.contact.meta.description,
  });
}

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  const email = contactEmail();
  const destinations = getDestinations().map((destination) => ({
    slug: destination.slug,
    name: pick(destination.name, locale),
  }));
  const packages = getPackages().map((travelPackage) => ({
    slug: travelPackage.slug,
    title: pick(travelPackage.title, locale),
    destination: travelPackage.destination,
  }));

  return (
    <main id="main" tabIndex={-1}>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[
          { name: dict.nav.home, path: "/" },
          { name: dict.nav.contact, path: "/contact/" },
        ]}
      />
      <div className="mx-auto grid w-full max-w-page gap-10 px-5 py-14 md:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
            {dict.contact.eyebrow}
          </p>
          <h1 className="mt-3 font-serif text-4xl tracking-tight text-ink sm:text-5xl">{dict.contact.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">{dict.contact.lede}</p>
          <p className="mt-6 text-sm text-ink">
            <span className="font-semibold">{dict.contact.emailLabel}: </span>
            {email ? (
              <a href={`mailto:${email}`} className="text-teal underline underline-offset-4 hover:text-teal-dark">
                {email}
              </a>
            ) : (
              dict.contact.emailPending
            )}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted">{dict.contact.chatNote}</p>
        </header>
        <div className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-7">
          <noscript>
            <p className="mb-4 rounded-2xl border border-line bg-sand-soft px-4 py-3 text-sm text-ink">
              {fill(dict.contact.noscript, { email: email || "contact@sundayatlastravel.com" })}
            </p>
          </noscript>
          <InquiryForm
            locale={locale}
            dict={dict}
            destinations={destinations}
            packages={packages}
            contactEmail={email}
          />
        </div>
      </div>
    </main>
  );
}
