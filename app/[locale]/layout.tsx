import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { JsonLd } from "@/components/seo/JsonLd";
import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { WhatsAppSlot } from "@/components/WhatsAppSlot";
import { Analytics } from "@/components/Analytics";
import { MotionObserver } from "@/components/motion/MotionObserver";
import { isLocale, isPartialLocale, localeTags, locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";
import { contactEmail, getSeoSettings, partialLocalePaths } from "@/lib/content";
import { pageRobots, siteVerification, twitterSite } from "@/lib/metadata";
import { travelAgencySchema } from "@/lib/structured-data";

const serif = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: "#FAF7F2",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = isLocale(locale) ? locale : "en";
  const dict = await getDictionary(safe);
  const settings = getSeoSettings();
  const template = settings.titleTemplate[safe] || `%s | ${dict.meta.titleSuffix}`;
  const description = settings.defaultDescription[safe] || dict.meta.defaultDescription;
  const verification = siteVerification();
  const handle = twitterSite();
  return {
    title: {
      default: dict.meta.defaultTitle,
      // Child pages set an absolute title in buildPageMetadata. The template
      // is "%s | Sunday Atlas Travel" unless SEO settings replace it.
      template,
    },
    description,
    icons: { icon: "/favicon.svg" },
    manifest: "/manifest.webmanifest",
    robots: pageRobots(false),
    ...(verification ? { verification } : {}),
    ...(handle ? { twitter: { site: handle } } : {}),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const dict = await getDictionary(locale);

  return (
    <html lang={localeTags[locale]} className={`${serif.variable} ${sans.variable}`}>
      <link rel="preconnect" href="https://res.cloudinary.com" crossOrigin="anonymous" />
      <link rel="dns-prefetch" href="https://res.cloudinary.com" />
      <body className="flex min-h-screen flex-col bg-cream font-sans text-ink antialiased">
        <a className="skip-link" href="#main">
          {dict.nav.skipToContent}
        </a>
        <Header
          locale={locale}
          nav={dict.nav}
          languages={dict.languages}
          siteName={dict.meta.siteName}
          subscribe={dict.subscribe}
          partialPaths={partialLocalePaths()}
        />
        {children}
        <Footer locale={locale} dict={dict} year={new Date().getFullYear()} email={contactEmail()} />
        {/* Chat answers in the five full locales only; zh pages offer the enquiry form instead. */}
        {isPartialLocale(locale) ? null : <ChatLauncher key={locale} locale={locale} chat={dict.chat} />}
        <WhatsAppSlot />
        <MotionObserver />
        <Analytics />
        <JsonLd data={travelAgencySchema(locale)} />
      </body>
    </html>
  );
}
