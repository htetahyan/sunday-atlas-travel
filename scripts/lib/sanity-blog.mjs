/** Shared mapping from content/blog/*.json to a Sanity `blogPost` document. */
export function withKeys(items, prefix) {
  if (!Array.isArray(items)) return [];
  return items.map((item, idx) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return { _key: item._key || `${prefix}-${idx + 1}`, ...item };
    }
    return item;
  });
}

export function toSanityBlogPost({ id, data }) {
  const slug = data.slug || id;
  return {
    _id: `blogPost-${slug}`,
    _type: "blogPost",
    slug,
    published: Boolean(data.published),
    ...(data.mergedInto ? { mergedInto: data.mergedInto } : {}),
    featured: Boolean(data.featured),
    category: data.category || "destination-guide",
    destination: data.destination || "",
    countries: Array.isArray(data.countries) ? data.countries : [],
    publishedAt: data.publishedAt || "2026-10-27",
    updatedAt: data.updatedAt || data.publishedAt || "2026-10-27",
    readingTimeMinutes: typeof data.readingTimeMinutes === "number" ? data.readingTimeMinutes : 8,
    ...(data.contentHash ? { contentHash: data.contentHash } : {}),
    ...(Array.isArray(data.refreshLog) ? { refreshLog: withKeys(data.refreshLog, "refresh") } : {}),
    title: data.title ?? { en: slug },
    subtitle: data.subtitle ?? { en: "" },
    summary: data.summary ?? { en: "" },
    intro: data.intro ?? { en: "" },
    ...(data.heroImage ? { heroImage: data.heroImage } : {}),
    sections: withKeys(
      (data.sections ?? []).map((s) => ({
        ...s,
        keyFacts: withKeys(s?.keyFacts, "fact"),
      })),
      "section",
    ),
    relatedPackages: Array.isArray(data.relatedPackages) ? data.relatedPackages : [],
    faqs: withKeys(data.faqs, "faq"),
    seo: data.seo ?? {},
  };
}
