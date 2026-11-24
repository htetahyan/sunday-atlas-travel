import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  BlogCard,
  PackageCard,
  formatBlogCategoryLabel,
} from "@/components/Cards";
import { CoverImage } from "@/components/CoverImage";
import { PhotoCredit } from "@/components/PhotoCredit";
import { PageFaq } from "@/components/PageFaq";
import { SubscribeForm } from "@/components/subscribe/SubscribeForm";
import { JsonLd } from "@/components/seo/JsonLd";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";
import { blogAnswerLine } from "@/lib/answer-lines";
import {
  blogCountries,
  formatPackageDuration,
  getBlogPost,
  getBlogPosts,
  getDestination,
  getPackage,
  imageAlt,
  isTranslated,
  localizeBlogPost,
  localizePackage,
  pick,
} from "@/lib/content";
import {
  absoluteUrl,
  buildPageMetadata,
  descriptionFromSummary,
  heroOpenGraphImage,
} from "@/lib/metadata";
import {
  formatDisplayDate,
  isoDateTime,
  lastModified,
  wasUpdatedAfterPublishing,
} from "@/lib/dates";
import {
  blogPostingSchema,
  breadcrumbSchema,
} from "@/lib/structured-data";

type Props = { params: Promise<{ locale: string; slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.flatMap((locale) =>
    getBlogPosts(locale).map((post) => ({ locale, slug: post.slug })),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const post = getBlogPost(slug);
  const dict = await getDictionary(locale);
  if (!post) {
    return buildPageMetadata({
      locale,
      path: `/blog/${slug}/`,
      title: dict.blog.meta.title,
      description: dict.blog.meta.description,
    });
  }
  const copy = localizeBlogPost(post, locale);
  const alt = imageAlt(post.heroImage, locale) || copy.title;
  return buildPageMetadata({
    locale,
    path: `/blog/${post.slug}/`,
    title: copy.title,
    description: descriptionFromSummary(copy.summary, dict.blog.meta.description),
    image: heroOpenGraphImage(post.heroImage?.src, alt),
    article: {
      publishedTime: isoDateTime(copy.publishedAt),
      modifiedTime: lastModified(copy.publishedAt, copy.updatedAt),
    },
  });
}

export default async function BlogArticlePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const post = getBlogPost(slug);
  if (!post) notFound();

  const dict = await getDictionary(locale);
  const copy = localizeBlogPost(post, locale);
  const answerLine = blogAnswerLine(post, locale, dict);
  const destination = getDestination(post.destination);
  const destName = destination ? pick(destination.name, locale) : copy.destination;
  const [heroFrom, heroTo] = destination?.heroGradient ?? ["#0F6E6E", "#1C2430"];

  const countries = blogCountries(post).flatMap((countrySlug) => {
    const place = getDestination(countrySlug);
    if (!place) return [];
    const name = pick(place.name, locale);
    return name ? [{ slug: place.slug, name }] : [];
  });

  const relatedPackages = copy.relatedPackages.flatMap((pkgSlug) => {
    const pkg = getPackage(pkgSlug);
    return pkg ? [pkg] : [];
  });

  const allPosts = getBlogPosts().filter((candidate) => candidate.slug !== post.slug);
  const sameDestPosts = allPosts.filter(
    (candidate) =>
      candidate.destination === post.destination ||
      blogCountries(candidate).some((c) => blogCountries(post).includes(c)),
  );
  const otherPosts = allPosts.filter((candidate) => !sameDestPosts.includes(candidate));
  const relatedPosts = [...sameDestPosts, ...otherPosts].slice(0, 3);

  const seoEntry = post.seo[locale] || post.seo.en;
  const targetKeywords = seoEntry?.keywords?.length
    ? seoEntry.keywords
    : seoEntry?.focusKeyword
      ? [seoEntry.focusKeyword]
      : [];

  const showContentNote = !isTranslated(post.summary, locale);
  const readingLabel = dict.blog.readingTime.replace(
    "{minutes}",
    String(copy.readingTimeMinutes || 9),
  );
  const isUpdated = wasUpdatedAfterPublishing(copy.publishedAt, copy.updatedAt);
  const [updatedBefore, updatedAfter] = dict.blog.publishedOn.split("{date}");
  const [publishedBefore, publishedAfter] = dict.blog.firstPublished.split("{date}");

  const breadcrumbItems = [
    { name: dict.nav.home, url: absoluteUrl(locale, "/") },
    { name: dict.nav.blog, url: absoluteUrl(locale, "/blog/") },
    ...(destination && destName
      ? [
          {
            name: destName,
            url: absoluteUrl(locale, `/destinations/${destination.slug}/`),
          },
        ]
      : []),
    { name: copy.title, url: absoluteUrl(locale, `/blog/${post.slug}/`) },
  ];

  return (
    <main id="main" tabIndex={-1} className="min-w-0">
      <JsonLd
        data={[
          breadcrumbSchema(breadcrumbItems, locale),
          ...blogPostingSchema(post, locale),
          // FAQPage comes from <PageFaq> below; emitting it here too gave two FAQPage blocks.
        ]}
      />

      <div className="border-b border-line bg-card">
        <div className="mx-auto max-w-page px-5 pb-8 pt-4 md:pb-10 lg:pt-5">
          <Breadcrumbs
            label={dict.breadcrumb.label}
            items={[
              { label: dict.nav.home, href: `/${locale}/` },
              { label: dict.nav.blog, href: `/${locale}/blog/` },
              ...(destination && destName
                ? [
                    {
                      label: destName,
                      href: `/${locale}/destinations/${destination.slug}/`,
                    },
                  ]
                : []),
              { label: copy.title },
            ]}
          />

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-teal-soft px-3 py-1 text-teal">
              {formatBlogCategoryLabel(copy.category, dict)}
            </span>
            {countries.map((c) => (
              <Link
                key={c.slug}
                href={`/${locale}/destinations/${c.slug}/`}
                className="rounded-full border border-line bg-cream px-3 py-1 text-ink transition-colors hover:border-teal hover:text-teal"
              >
                {c.name}
              </Link>
            ))}
            <span className="text-muted">· {readingLabel}</span>
            {isUpdated ? (
              <span className="text-muted" data-article-dates="updated">
                · {updatedBefore}
                <time
                  dateTime={isoDateTime(copy.updatedAt)}
                  itemProp="dateModified"
                  className="font-medium text-ink/80"
                >
                  {formatDisplayDate(copy.updatedAt, locale)}
                </time>
                {updatedAfter}
                <span className="text-muted/80">
                  {" "}
                  ({publishedBefore}
                  <time dateTime={isoDateTime(copy.publishedAt)} itemProp="datePublished">
                    {formatDisplayDate(copy.publishedAt, locale)}
                  </time>
                  {publishedAfter})
                </span>
              </span>
            ) : (
              <span className="text-muted" data-article-dates="published">
                · {publishedBefore}
                <time
                  dateTime={isoDateTime(copy.publishedAt)}
                  itemProp="datePublished"
                  className="font-medium text-ink/80"
                >
                  {formatDisplayDate(copy.publishedAt, locale)}
                </time>
                {publishedAfter}
              </span>
            )}
          </div>

          <h1 className="mt-3 max-w-4xl font-serif text-3xl tracking-tight text-ink sm:text-4xl lg:text-5xl">
            {copy.title}
          </h1>
          {copy.subtitle ? (
            <p className="mt-3 max-w-3xl text-lg font-medium leading-snug text-ink/85 sm:text-xl">
              {copy.subtitle}
            </p>
          ) : null}
          {copy.summary ? (
            <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted sm:text-lg">
              {copy.summary}
            </p>
          ) : null}
          {answerLine ? (
            <p data-answer-line className="mt-3 max-w-3xl text-sm font-medium leading-snug text-ink">
              {answerLine}
            </p>
          ) : null}
          {showContentNote ? (
            <p className="mt-2 text-sm text-muted">{dict.contentNote}</p>
          ) : null}

          {copy.heroImage?.src ? (
            <div
              className="relative mt-6 aspect-[16/9] max-h-[520px] w-full overflow-hidden rounded-3xl border border-line shadow-card"
              style={{
                backgroundImage: `linear-gradient(150deg, ${heroFrom}, ${heroTo})`,
              }}
            >
              <CoverImage
                src={copy.heroImage.src}
                alt={imageAlt(copy.heroImage, locale) || copy.title}
                width={copy.heroImage.width}
                height={copy.heroImage.height}
                priority
                sizes="(min-width: 1200px) 1140px, 100vw"
              />
            </div>
          ) : null}
          {copy.heroImage?.credit?.required ? (
            <p className="mt-2 text-right">
              <PhotoCredit credit={copy.heroImage.credit} locale={locale} />
            </p>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-page px-5 py-10 md:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_350px] lg:items-start">
          <div className="min-w-0 space-y-10">
            {copy.intro ? (
              <div className="rounded-2xl border border-line bg-card p-6 shadow-card sm:p-8">
                <p className="text-base leading-relaxed text-ink sm:text-lg">
                  {copy.intro}
                </p>
              </div>
            ) : null}

            {copy.sections.length > 1 ? (
              <nav
                aria-label={dict.blog.tocTitle}
                className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">
                  {dict.blog.tocTitle}
                </p>
                <ol className="mt-3 grid gap-2 sm:grid-cols-2">
                  {copy.sections.map((sec, idx) => (
                    <li key={sec.id}>
                      <a
                        href={`#${sec.id}`}
                        className="group flex items-start gap-2.5 rounded-xl px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-cream hover:text-teal"
                      >
                        <span className="mt-0.5 inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-teal-soft px-1.5 text-xs font-bold text-teal">
                          {sec.rankNumber ?? idx + 1}
                        </span>
                        <span className="font-medium leading-snug group-hover:underline">
                          {sec.placeName || sec.heading}
                        </span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}

            {copy.sections.map((sec) => {
              const embeddedPkg = sec.embeddedPackageSlug
                ? getPackage(sec.embeddedPackageSlug)
                : undefined;
              const embeddedCopy = embeddedPkg
                ? localizePackage(embeddedPkg, locale)
                : undefined;
              const embeddedDuration = embeddedPkg && embeddedCopy
                ? formatPackageDuration(
                    embeddedCopy.durationDays,
                    embeddedCopy.nights,
                    dict.packages,
                  )
                : "";

              return (
                <section
                  key={sec.id}
                  id={sec.id}
                  className="scroll-mt-24 rounded-3xl border border-line bg-card p-6 shadow-card sm:p-8"
                >
                  {typeof sec.rankNumber === "number" ? (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-teal px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                        {dict.blog.rankBadge.replace(
                          "{rank}",
                          String(sec.rankNumber),
                        )}
                      </span>
                      {sec.placeName ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-sand-deep">
                          {sec.placeName}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <h2 className="font-serif text-2xl leading-snug text-ink sm:text-3xl">
                    {sec.heading}
                  </h2>

                  {sec.image?.src ? (
                    <figure className="mt-5 overflow-hidden rounded-2xl border border-line bg-cream">
                      <div className="relative aspect-[16/10] w-full overflow-hidden">
                        <CoverImage
                          src={sec.image.src}
                          alt={sec.image.alt || sec.heading}
                          width={sec.image.width}
                          height={sec.image.height}
                          sizes="(min-width: 1024px) 740px, 100vw"
                        />
                      </div>
                      {sec.image.caption || sec.image.credit?.required ? (
                        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-muted">
                          {sec.image.caption ? <span>{sec.image.caption}</span> : null}
                          <PhotoCredit credit={sec.image.credit} locale={locale} />
                        </figcaption>
                      ) : null}
                    </figure>
                  ) : null}

                  <div className="mt-5 space-y-4 text-base leading-relaxed text-ink/90">
                    {sec.paragraphs.map((paragraph, pIdx) => (
                      <p key={pIdx}>{paragraph}</p>
                    ))}
                  </div>

                  {sec.highlights.length > 0 ? (
                    <ul className="mt-5 grid gap-2.5 rounded-2xl border border-line bg-cream p-4 sm:grid-cols-2 sm:p-5">
                      {sec.highlights.map((item, hIdx) => (
                        <li
                          key={hIdx}
                          className="flex items-start gap-2 text-sm leading-snug text-ink"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal"
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {sec.keyFacts.length > 0 ? (
                    <dl className="mt-5 grid gap-3 rounded-2xl border border-line bg-cream p-4 sm:grid-cols-2 sm:p-5">
                      {sec.keyFacts.map((fact, fIdx) => (
                        <div
                          key={fIdx}
                          className="rounded-xl border border-line bg-card px-3.5 py-2.5"
                        >
                          <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-sand-deep">
                            {fact.label}
                          </dt>
                          <dd className="mt-1 text-sm font-medium text-ink">
                            {fact.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {embeddedPkg && embeddedCopy ? (
                    <div className="mt-6 overflow-hidden rounded-2xl border-2 border-teal/25 bg-teal-soft/45 p-4 sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        {embeddedCopy.image?.src ? (
                          <Link
                            href={`/${locale}/packages/${embeddedPkg.slug}/`}
                            className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-xl border border-line sm:w-44"
                          >
                            <CoverImage
                              src={embeddedCopy.image.src}
                              alt={
                                imageAlt(embeddedCopy.image, locale) ||
                                embeddedCopy.title
                              }
                              width={embeddedCopy.image.width}
                              height={embeddedCopy.image.height}
                              sizes="180px"
                            />
                          </Link>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                            <span className="rounded-full bg-teal px-2.5 py-0.5 text-white">
                              {dict.blog.inlineTourBadge}
                            </span>
                            {embeddedDuration ? (
                              <span className="text-ink/80">
                                · {embeddedDuration}
                              </span>
                            ) : null}
                            {embeddedCopy.fromLabel ? (
                              <span className="font-bold text-teal">
                                · {embeddedCopy.fromLabel}
                              </span>
                            ) : null}
                          </div>
                          <h3 className="mt-1.5 font-serif text-xl leading-snug text-ink">
                            <Link
                              href={`/${locale}/packages/${embeddedPkg.slug}/`}
                              className="hover:text-teal hover:underline"
                            >
                              {embeddedCopy.title}
                            </Link>
                          </h3>
                          {embeddedCopy.summary ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted sm:text-sm">
                              {embeddedCopy.summary}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap items-center gap-2.5">
                            <Link
                              href={`/${locale}/packages/${embeddedPkg.slug}/`}
                              className="inline-flex items-center gap-1.5 rounded-full bg-teal px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-dark"
                            >
                              {dict.blog.viewItinerary} →
                            </Link>
                            <Link
                              href={`/${locale}/contact?package=${embeddedPkg.slug}`}
                              rel="nofollow"
                              className="inline-flex items-center rounded-full border border-teal/40 bg-card px-4 py-2 text-xs font-semibold text-teal transition-colors hover:bg-teal hover:text-white"
                            >
                              {dict.blog.requestCustomQuote}
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}

            {targetKeywords.length > 0 ? (
              <div className="rounded-2xl border border-line bg-card p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sand-deep">
                  {dict.blog.keywordsLabel}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {targetKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded-full border border-line bg-cream px-3 py-1 text-xs text-muted"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <PageFaq title={dict.blog.faqTitle} items={copy.faqs} />
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24">
            <div className="rounded-2xl border border-line bg-card p-5 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">
                {dict.blog.inlineTourBadge}
              </p>
              <h2 className="mt-2 font-serif text-2xl leading-snug text-ink">
                {dict.blog.sidebarToursTitle}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {dict.blog.sidebarToursLede}
              </p>

              <div className="mt-4 space-y-3.5">
                {relatedPackages.map((pkg) => {
                  const pkgCopy = localizePackage(pkg, locale);
                  const dur = formatPackageDuration(
                    pkgCopy.durationDays,
                    pkgCopy.nights,
                    dict.packages,
                  );
                  return (
                    <div
                      key={pkg.slug}
                      className="rounded-xl border border-line bg-cream p-3.5 transition-colors hover:border-teal/50"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-sand-deep">
                          {dur}
                        </span>
                        {pkgCopy.fromLabel ? (
                          <span className="rounded-full bg-teal-soft px-2.5 py-0.5 font-bold text-teal">
                            {pkgCopy.fromLabel}
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-1.5 font-serif text-base leading-snug text-ink">
                        <Link
                          href={`/${locale}/packages/${pkg.slug}/`}
                          className="hover:text-teal hover:underline"
                        >
                          {pkgCopy.title}
                        </Link>
                      </h3>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Link
                          href={`/${locale}/packages/${pkg.slug}/`}
                          className="inline-flex items-center rounded-full bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-dark"
                        >
                          {dict.blog.viewItinerary} →
                        </Link>
                        <Link
                          href={`/${locale}/contact?package=${pkg.slug}`}
                          rel="nofollow"
                          className="inline-flex items-center rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:border-teal hover:text-teal"
                        >
                          {dict.blog.requestCustomQuote}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>

              {destination && destName ? (
                <div className="mt-5 border-t border-line pt-4">
                  <Link
                    href={`/${locale}/destinations/${destination.slug}/`}
                    className="inline-flex w-full items-center justify-center rounded-full border border-line bg-cream px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:border-teal hover:text-teal"
                  >
                    {destName} →
                  </Link>
                </div>
              ) : null}
            </div>
          </aside>
        </div>

        <section
          data-reveal
          aria-label={dict.subscribe.title}
          className="mt-16 overflow-hidden rounded-3xl bg-teal px-6 py-8 text-white shadow-card md:px-10 md:py-10"
        >
          <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-soft">{dict.subscribe.eyebrow}</p>
              <h2 className="mt-2 font-serif text-3xl tracking-tight">{dict.subscribe.blogTitle}</h2>
              <p className="mt-2 text-white/90">{dict.subscribe.blogBody}</p>
            </div>
            <SubscribeForm locale={locale} copy={dict.subscribe} tone="dark" source="blog" />
          </div>
        </section>

        {relatedPackages.length > 0 ? (
          <section className="mt-16 border-t border-line pt-12">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">
                  {dict.blog.inlineTourBadge}
                </p>
                <h2 className="mt-2 font-serif text-3xl text-ink">
                  {dict.blog.relatedToursTitle}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  {dict.blog.relatedToursLede}
                </p>
              </div>
              <Link
                href={`/${locale}/packages/`}
                className="text-sm font-semibold text-teal hover:underline"
              >
                {dict.cta.browsePackages} →
              </Link>
            </div>
            <div data-reveal-group className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {relatedPackages.map((pkg) => (
                <PackageCard
                  key={pkg.slug}
                  travelPackage={pkg}
                  locale={locale}
                  dict={dict}
                />
              ))}
            </div>
          </section>
        ) : null}

        {relatedPosts.length > 0 ? (
          <section className="mt-16 border-t border-line pt-12">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-deep">
                  {dict.blog.eyebrow}
                </p>
                <h2 className="mt-2 font-serif text-3xl text-ink">
                  {dict.blog.relatedGuidesTitle}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  {dict.blog.relatedGuidesLede}
                </p>
              </div>
              <Link
                href={`/${locale}/blog/`}
                className="text-sm font-semibold text-teal hover:underline"
              >
                {dict.blog.backToBlog} →
              </Link>
            </div>
            <div data-reveal-group className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {relatedPosts.map((relatedPost) => (
                <BlogCard
                  key={relatedPost.slug}
                  post={relatedPost}
                  locale={locale}
                  dict={dict}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
