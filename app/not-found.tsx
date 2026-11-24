import { locales, localeNames } from "@/i18n/config";
import en from "@/i18n/dictionaries/en.json";
import { ogLocale, twitterSite } from "@/lib/metadata";

export default function NotFound() {
  const handle = twitterSite();
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {handle ? <meta name="twitter:site" content={handle} /> : null}
        <meta property="og:locale" content={ogLocale("en")} />
        {locales
          .filter((locale) => locale !== "en")
          .map((locale) => (
            <meta key={locale} property="og:locale:alternate" content={ogLocale(locale)} />
          ))}
        <title>{`${en.notFound.metaTitle} | Sunday Atlas Travel`}</title>
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body
        style={{
          margin: 0,
          background: "#FAF7F2",
          color: "#1C2430",
          fontFamily: "Georgia, 'Hiragino Mincho ProN', serif",
        }}
      >
        <main style={{ maxWidth: 640, margin: "0 auto", padding: "4rem 1.25rem" }}>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 500, letterSpacing: "-0.02em" }}>
            {en.notFound.title}
          </h1>
          <p style={{ fontSize: "1.125rem", lineHeight: 1.6, color: "#3E4C5A" }}>{en.notFound.body}</p>
          <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: "0.5rem" }}>
            {locales.map((locale) => (
              <li key={locale}>
                <a href={`/${locale}/`} hrefLang={locale} lang={locale} style={{ color: "#0F6E6E" }}>
                  {localeNames[locale]}
                </a>
              </li>
            ))}
          </ul>
        </main>
      </body>
    </html>
  );
}
