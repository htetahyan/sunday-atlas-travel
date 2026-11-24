import Script from "next/script";
import { getSeoSettings } from "@/lib/content";

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * GA4 or Cloudflare Web Analytics. Renders nothing unless a provider and a
 * non-empty id are both set, so an empty settings file ships no analytics.
 */
export function Analytics() {
  const { provider, id } = getSeoSettings().analytics;
  const token = id.trim();
  if (!token || provider === "none" || !SAFE_ID.test(token)) return null;

  if (provider === "ga4") {
    return (
      <>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${token}`}
          strategy="afterInteractive"
        />
        <Script id="ga4-config" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${token}');`}
        </Script>
      </>
    );
  }

  if (provider === "cloudflare") {
    return (
      <Script
        defer
        src="https://static.cloudflareinsights.com/beacon.min.js"
        strategy="lazyOnload"
        data-cf-beacon={`{"token":"${token}"}`}
      />
    );
  }

  return null;
}
