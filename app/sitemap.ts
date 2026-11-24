import type { MetadataRoute } from "next";
import { heroImage } from "@/config/images";
import { locales } from "@/i18n/config";
import {
  getBlogPost,
  getBlogPosts,
  getDestination,
  getDestinations,
  getPackage,
  getPackages,
  getPackagesByDestination,
  pathAvailableIn,
  seoForPath,
} from "@/lib/content";
import { cmsUpdatedAt, latestDate } from "@/lib/content-dates";
import { lastModified as postLastModified } from "@/lib/dates";
import { absoluteAssetUrl, absoluteUrl, localeAlternates } from "@/lib/metadata";

export const dynamic = "force-static";

const STATIC_PATHS = [
  "/",
  "/about/",
  "/contact/",
  "/faq/",
  "/how-it-works/",
  "/privacy/",
  "/terms/",
  "/destinations/",
  "/packages/",
  "/blog/",
] as const;

/**
 * Every URL carries its real last content change, never the build time:
 *   - blog posts: the post's updatedAt / publishedAt;
 *   - packages and destinations: Sanity _updatedAt (see src/lib/content-dates.ts), and a destination
 *     page also moves when one of its tours changes;
 *   - list pages and the home page: the newest of their own CMS page and everything they list;
 *   - other static pages: their CMS page document.
 * A URL with no known date is listed without <lastmod>.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const modified = new Map<string, Date>();
  const set = (p: string, date: Date | undefined) => {
    if (date) modified.set(p, date);
  };
  const posts = getBlogPosts();
  const packages = getPackages();
  const destinations = getDestinations();

  const postDates = posts.map((post) => {
    const date = new Date(postLastModified(post.publishedAt, post.updatedAt));
    set(`/blog/${post.slug}/`, date);
    return date;
  });
  const packageDates = packages.map((travelPackage) => {
    const date = latestDate([cmsUpdatedAt(`packages/${travelPackage.slug}`)]);
    set(`/packages/${travelPackage.slug}/`, date);
    return date;
  });
  const destinationDates = destinations.map((destination) => {
    const date = latestDate([
      cmsUpdatedAt(`destinations/${destination.slug}`),
      ...getPackagesByDestination(destination.slug).map((p) => cmsUpdatedAt(`packages/${p.slug}`)),
    ]);
    set(`/destinations/${destination.slug}/`, date);
    return date;
  });
  set("/blog/", latestDate([cmsUpdatedAt("pages/blog"), ...postDates]));
  set("/packages/", latestDate([cmsUpdatedAt("pages/packages"), ...packageDates]));
  set("/destinations/", latestDate([cmsUpdatedAt("pages/destinations"), ...destinationDates]));
  set("/", latestDate([cmsUpdatedAt("pages/home"), ...packageDates, ...destinationDates, ...postDates]));
  for (const p of STATIC_PATHS) {
    if (modified.has(p)) continue;
    const id = p.replace(/^\/|\/$/g, "");
    set(p, latestDate([cmsUpdatedAt(`pages/${id}`)]));
  }

  const paths = [
    ...STATIC_PATHS,
    ...destinations.map((destination) => `/destinations/${destination.slug}/`),
    ...packages.map((travelPackage) => `/packages/${travelPackage.slug}/`),
    ...posts.map((post) => `/blog/${post.slug}/`),
  ];

  return locales.flatMap((locale) =>
    paths.flatMap((path) => {
      if (!pathAvailableIn(path, locale) || seoForPath(path, locale).noindex) return [];
      const images = imagesForPath(path);
      const lastModified = modified.get(path);
      return [
        {
          url: absoluteUrl(locale, path),
          ...(lastModified ? { lastModified } : {}),
          alternates: {
            languages: localeAlternates(path),
          },
          ...(images ? { images } : {}),
        },
      ];
    }),
  );
}

/** Home uses the hero. Destination and package pages add every gallery frame after the main photo. */
function imagesForPath(path: string): string[] | undefined {
  if (path === "/") return [absoluteAssetUrl(heroImage.src)];
  const destinationMatch = path.match(/^\/destinations\/([^/]+)\/$/);
  if (destinationMatch) {
    const destination = getDestination(destinationMatch[1]);
    return destination ? pageImages(destination.image?.src, destination.gallery) : undefined;
  }
  const packageMatch = path.match(/^\/packages\/([^/]+)\/$/);
  if (packageMatch) {
    const travelPackage = getPackage(packageMatch[1]);
    return travelPackage ? pageImages(travelPackage.image?.src, travelPackage.gallery) : undefined;
  }
  const blogMatch = path.match(/^\/blog\/([^/]+)\/$/);
  if (blogMatch) {
    const post = getBlogPost(blogMatch[1]);
    if (!post) return undefined;
    return pageImages(
      post.heroImage?.src,
      post.sections.map((s) => ({ image: s.image })),
    );
  }
  return undefined;
}

function pageImages(
  mainSrc: string | undefined,
  gallery: { image?: { src?: string } }[] | undefined,
): string[] | undefined {
  const urls: string[] = [];
  const hero = mainSrc?.trim();
  if (hero) urls.push(absoluteAssetUrl(hero));
  for (const item of gallery ?? []) {
    const src = item.image?.src?.trim();
    if (src) urls.push(absoluteAssetUrl(src));
  }
  return urls.length > 0 ? urls : undefined;
}
