export const siteName = "Sunday Atlas Travel";
export const siteShortName = "Sunday Atlas";

const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";

export const siteUrl =
  rawSiteUrl && !rawSiteUrl.endsWith(".pages.dev")
    ? rawSiteUrl.replace(/\/+$/, "")
    : "https://sundayatlastravel.com";

/**
 * True when NEXT_PUBLIC_INDEXABLE=true (or when building production for sundayatlastravel.com
 * unless NEXT_PUBLIC_INDEXABLE is explicitly set to "false" on a preview host).
 */
export const isIndexable =
  process.env.NEXT_PUBLIC_INDEXABLE === "true" ||
  (siteUrl === "https://sundayatlastravel.com" && process.env.NEXT_PUBLIC_INDEXABLE !== "false");

/**
 * Social profile URLs that are set in the CMS but not live yet. They are dropped from
 * Organization `sameAs`, the twitter:site tag and any visible link until the account exists;
 * delete an entry here once the profile is real.
 */
export const pendingSocialUrls: readonly string[] = ["https://x.com/sundayatlastrvl"];
