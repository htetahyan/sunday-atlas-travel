/**
 * Sanity CMS client & GROQ queries for Sunday Atlas Travel.
 *
 * When NEXT_PUBLIC_SANITY_PROJECT_ID is configured, the site can query live or
 * build-time content from the Sanity Content Lake via its HTTP API. When not
 * set (or during local offline builds), src/lib/content.ts seamlessly falls
 * back to the git-backed JSON files in content/, which use the exact same
 * localized document structure.
 */

export const sanityConfig = {
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "mi09tcmc",
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01",
  useCdn: process.env.NODE_ENV === "production",
};

export function isSanityConfigured(): boolean {
  return Boolean(sanityConfig.projectId);
}

/**
 * Execute a GROQ query against the Sanity HTTP API with zero external runtime
 * dependencies (works in Next.js Node builds and Cloudflare Workers).
 */
export async function sanityFetch<T>(
  query: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T | null> {
  if (!sanityConfig.projectId) return null;

  const host = sanityConfig.useCdn ? "apicdn.sanity.io" : "api.sanity.io";
  const url = new URL(
    `https://${sanityConfig.projectId}.${host}/v${sanityConfig.apiVersion}/data/query/${sanityConfig.dataset}`,
  );
  url.searchParams.set("query", query);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(`$${key}`, JSON.stringify(value));
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (process.env.SANITY_API_READ_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SANITY_API_READ_TOKEN}`;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Sanity query failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { result: T };
  return body.result;
}

export const GROQ_QUERIES = {
  allDestinations: `*[_type == "destination"] | order(slug asc)`,
  publishedDestinations: `*[_type == "destination" && published == true] | order(slug asc)`,
  destinationBySlug: `*[_type == "destination" && slug == $slug][0]`,
  allPackages: `*[_type == "travelPackage"] | order(durationDays desc, slug asc)`,
  publishedPackages: `*[_type == "travelPackage" && published == true] | order(featured desc, durationDays desc, slug asc)`,
  packageBySlug: `*[_type == "travelPackage" && slug == $slug][0]`,
  allBlogPosts: `*[_type == "blogPost"] | order(featured desc, publishedAt desc, slug asc)`,
  publishedBlogPosts: `*[_type == "blogPost" && published == true] | order(featured desc, publishedAt desc, slug asc)`,
  blogPostBySlug: `*[_type == "blogPost" && slug == $slug][0]`,
  staticPageById: `*[_type == "staticPage" && pageId == $pageId][0]`,
  siteSettings: `*[_type == "siteSettings"][0]`,
} as const;
