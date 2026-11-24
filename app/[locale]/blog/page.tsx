import Link from "next/link";
import { formatDisplayDate, lastModified, wasUpdatedAfterPublishing } from "@/lib/dates";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogCatalog } from "@/components/BlogCatalog";
import { formatBlogCategoryLabel } from "@/components/Cards";
import { CoverImage } from "@/components/CoverImage";
import { PageFaq } from "@/components/PageFaq";
import { PageSections } from "@/components/PageSections";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { JsonLd } from "@/components/seo/JsonLd";
import { hasBlog, isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";
import {
  blogCountries,
  getBlogPosts,
  getDestination,
  getDestinations,
  getStaticPage,
  imageAlt,
  isTranslated,
  localizeBlogPost,
  localizeFaqTitle,
  localizeFaqs,
  localizePageSections,
  pick,
} from "@/lib/content";
import { buildPageMetadata } from "@/lib/metadata";
import { blogListSchema } from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string }> };

/** No blog in partial locales (zh): no /zh/blog/ page is generated. */
export const dynamicParams = false;

export function generateStaticParams() {
  return locales.filter((locale) => hasBlog(locale)).map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return buildPageMetadata({
    locale,
    path: "/blog/",
    title: dict.blog.meta.title,
    description: dict.blog.meta.description,
  });
}

export default async function BlogIndexPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = await getDictionary(locale);
  const posts = getBlogPosts();
  const destinations = getDestinations().map((dest) => ({
    slug: dest.slug,
    name: pick(dest.name, locale) || dest.slug,
  }));
  const blogPage = getStaticPage("blog");
  const pageFaqs = localizeFaqs(blogPage.faqs, locale);
  const pageFaqTitle =
    localizeFaqTitle(blogPage.faqTitle, locale) || dict.common.pageFaqTitle;
  const pageSections = localizePageSections(blogPage.sections, locale);

  const featuredPost = posts.find((post) => post.featured) || posts[0];
  const featuredCopy = featuredPost ? localizeBlogPost(featuredPost, locale) : null;
  const featuredDest = featuredPost ? getDestination(featuredPost.destination) : null;
  const [heroFrom, heroTo] = featuredDest?.heroGradient ?? ["#0F6E6E", "#1C2430"];
  const featuredCountries = featuredPost
    ? blogCountries(featuredPost).flatMap((slug) => {
        const place = getDestination(slug);
        return place ? [pick(place.name, locale)] : [];
      })
    : [];

  return (
    <main id="main" tabIndex={-1}>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[
          { name: dict.nav.home, path: "/" },
          { name: dict.nav.blog, path: "/blog/" },
        ]}
      />
      {posts.length > 0 ? <JsonLd data={blogListSchema(posts, locale)} /> : null}
      <div className="mx-auto max-w-page px-5 py-14 md:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand-deep">
          {dict.blog.eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl font-serif text-4xl tracking-tight text-ink sm:text-5xl">
          {dict.blog.title}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
          {dict.blog.lede}
        </p>
        {posts.some((post) => !isTranslated(post.summary, locale)) ? (
          <p className="mt-4 text-sm text-muted">{dict.contentNote}</p>
        ) : null}

        {featuredPost && featuredCopy ? (
          <article className="atlas-card group relative mt-10 overflow-hidden rounded-3xl border border-line bg-card shadow-card lg:grid lg:grid-cols-[1.15fr_1fr]">
            <div
              className="relative aspect-[16/10] min-h-[260px] overflow-hidden lg:aspect-auto lg:min-h-[380px] [&_img]:transition-transform [&_img]:duration-500 group-hover:[&_img]:scale-[1.02]"
              style={{
                backgroundImage: `linear-gradient(150deg, ${heroFrom}, ${heroTo})`,
              }}
            >
              {featuredCopy.heroImage?.src ? (
                <CoverImage
                  src={featuredCopy.heroImage.src}
                  alt={imageAlt(featuredCopy.heroImage, locale) || featuredCopy.title}
                  width={featuredCopy.heroImage.width}
                  height={featuredCopy.heroImage.height}
                  sizes="(min-width: 1024px) 620px, 100vw"
                />
              ) : null}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/55 via-transparent to-transparent" />
              <div className="absolute left-5 top-5 flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="rounded-full bg-teal px-3 py-1 text-white shadow-sm">
                  {dict.blog.featuredBadge}
                </span>
                <span className="rounded-full bg-ink/70 px-3 py-1 text-white backdrop-blur-sm">
                  {featuredCountries.join(" · ") || featuredCopy.destination}
                </span>
              </div>
            </div>
            <div className="flex flex-col justify-between p-6 sm:p-8 lg:p-10">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-teal-soft px-3 py-1 text-teal">
                    {formatBlogCategoryLabel(featuredCopy.category, dict)}
                  </span>
                  <span className="text-muted">
                    ·{" "}
                    {dict.blog.readingTime.replace(
                      "{minutes}",
                      String(featuredCopy.readingTimeMinutes || 9),
                    )}
                  </span>
                </div>
                <h2 className="mt-3 font-serif text-2xl leading-snug text-ink sm:text-3xl">
                  <Link
                    href={`/${locale}/blog/${featuredCopy.slug}/`}
                    className="transition-colors group-hover:text-teal after:absolute after:inset-0 after:z-10 after:content-['']"
                  >
                    {featuredCopy.title}
                  </Link>
                </h2>
                {featuredCopy.subtitle ? (
                  <p className="mt-2 text-base font-medium text-ink/85">
                    {featuredCopy.subtitle}
                  </p>
                ) : null}
                <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                  {featuredCopy.summary}
                </p>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-line pt-4 text-sm">
                <time
                  className="text-xs text-muted"
                  dateTime={lastModified(featuredCopy.publishedAt, featuredCopy.updatedAt)}
                >
                  {(wasUpdatedAfterPublishing(featuredCopy.publishedAt, featuredCopy.updatedAt)
                    ? dict.blog.publishedOn
                    : dict.blog.firstPublished
                  ).replace(
                    "{date}",
                    formatDisplayDate(
                      lastModified(featuredCopy.publishedAt, featuredCopy.updatedAt),
                      locale,
                    ),
                  )}
                </time>
                <span className="inline-flex items-center gap-1.5 font-semibold text-teal group-hover:underline">
                  {dict.cta.viewGuide} →
                </span>
              </div>
            </div>
          </article>
        ) : null}

        <div className="mt-10">
          <BlogCatalog
            posts={posts}
            destinations={destinations}
            locale={locale}
            dict={dict}
          />
        </div>

        <PageSections sections={pageSections} />
        <PageFaq title={pageFaqTitle} items={pageFaqs} />
      </div>
    </main>
  );
}
