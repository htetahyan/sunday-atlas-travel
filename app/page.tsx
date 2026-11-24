import { locales } from "@/i18n/config";
import { ogLocale, pageRobots, twitterSite } from "@/lib/metadata";

export default function RootRedirectPage() {
  const handle = twitterSite();
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="refresh" content="0; url=/en/" />
        <title>Sunday Atlas Travel</title>
        <meta name="robots" content={pageRobots(false)} />
        {handle ? <meta name="twitter:site" content={handle} /> : null}
        <meta property="og:locale" content={ogLocale("en")} />
        {locales
          .filter((locale) => locale !== "en")
          .map((locale) => (
            <meta key={locale} property="og:locale:alternate" content={ogLocale(locale)} />
          ))}
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body
        style={{
          margin: "2rem",
          background: "#FAF7F2",
          color: "#1C2430",
          fontFamily: "Georgia, 'Hiragino Mincho ProN', serif",
        }}
      >
        <p>
          <a href="/en/">Sunday Atlas Travel</a>
        </p>
      </body>
    </html>
  );
}
