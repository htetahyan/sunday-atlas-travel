import { defineField, defineType } from "../lib/define";

export const blogPost = defineType({
  name: "blogPost",
  title: "Blog / Travel Guide",
  type: "document",
  groups: [
    { name: "editorial", title: "Article & Metadata", default: true },
    { name: "sections", title: "Sections & Inline Tours" },
    { name: "media", title: "Hero Image" },
    { name: "seo", title: "FAQs & SEO" },
  ],
  fields: [
    defineField({
      name: "slug",
      title: "URL Slug",
      type: "string",
      group: "editorial",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "published",
      title: "Published on live site",
      type: "boolean",
      group: "editorial",
      initialValue: true,
    }),
    defineField({
      name: "featured",
      title: "Featured Guide on Blog Hub",
      type: "boolean",
      group: "editorial",
      initialValue: false,
    }),
    defineField({
      name: "category",
      title: "Article Format / Category (top-places | destination-guide | day-trips | seasonal)",
      type: "string",
      group: "editorial",
      initialValue: "destination-guide",
    }),
    defineField({
      name: "destination",
      title: "Primary Destination Slug (e.g. uzbekistan)",
      type: "string",
      group: "editorial",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "countries",
      title: "Additional Country Slugs",
      type: "array",
      group: "editorial",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "publishedAt",
      title: "Published Date (YYYY-MM-DD)",
      type: "string",
      group: "editorial",
    }),
    defineField({
      name: "updatedAt",
      title: "Last Updated Date (YYYY-MM-DD)",
      type: "string",
      group: "editorial",
    }),
    defineField({
      name: "readingTimeMinutes",
      title: "Reading Time (Minutes)",
      type: "number",
      group: "editorial",
      initialValue: 8,
    }),
    defineField({
      name: "title",
      title: "Article Title (H1)",
      type: "localizedString",
      group: "editorial",
    }),
    defineField({
      name: "subtitle",
      title: "Article Subtitle / Deck",
      type: "localizedString",
      group: "editorial",
    }),
    defineField({
      name: "summary",
      title: "Card Summary (150–180 chars)",
      type: "localizedString",
      group: "editorial",
    }),
    defineField({
      name: "intro",
      title: "Opening Introduction",
      type: "localizedString",
      group: "editorial",
    }),
    defineField({
      name: "heroImage",
      title: "Hero Image (Cloudinary URL)",
      type: "object",
      group: "media",
      fields: [
        defineField({ name: "src", title: "Cloudinary URL", type: "url" }),
        defineField({ name: "width", title: "Width (px)", type: "number" }),
        defineField({ name: "height", title: "Height (px)", type: "number" }),
        defineField({ name: "alt", title: "Alt Text", type: "localizedString" }),
        defineField({
          name: "credit",
          title: "Photo Credit (set by the image finder)",
          type: "object",
          fields: [
            defineField({ name: "author", title: "Author", type: "string" }),
            defineField({ name: "license", title: "Licence", type: "string" }),
            defineField({ name: "licenseUrl", title: "Licence URL", type: "url" }),
            defineField({ name: "sourceUrl", title: "Source page", type: "url" }),
            defineField({ name: "provider", title: "Provider", type: "string" }),
            defineField({ name: "required", title: "Licence requires a visible credit", type: "boolean" }),
          ],
        }),
      ],
    }),
    defineField({
      name: "sections",
      title: "Article Sections (Supports Listicles & Inline Tour Cards)",
      type: "array",
      group: "sections",
      of: [
        {
          type: "object",
          name: "blogSection",
          title: "Blog Section",
          fields: [
            defineField({ name: "id", title: "Anchor ID (e.g. registan-samarkand)", type: "string" }),
            defineField({
              name: "rankNumber",
              title: "Listicle Rank Number (e.g. 1, 2, 3, 4 for Top Places articles)",
              type: "number",
            }),
            defineField({
              name: "placeName",
              title: "Place / Landmark Badge Name (optional)",
              type: "localizedString",
            }),
            defineField({ name: "heading", title: "Section H2 Heading", type: "localizedString" }),
            defineField({
              name: "paragraphs",
              title: "Body Paragraphs",
              type: "localizedStringArray",
            }),
            defineField({
              name: "highlights",
              title: "Key Highlights / Bullet Points",
              type: "localizedStringArray",
            }),
            defineField({
              name: "keyFacts",
              title: "Quick Facts / Practical Table Rows",
              type: "array",
              of: [
                {
                  type: "object",
                  name: "factRow",
                  title: "Fact Row",
                  fields: [
                    defineField({ name: "label", title: "Label", type: "localizedString" }),
                    defineField({ name: "value", title: "Value", type: "localizedString" }),
                  ],
                },
              ],
            }),
            defineField({
              name: "image",
              title: "Section Image (Cloudinary URL)",
              type: "object",
              fields: [
                defineField({ name: "src", title: "Cloudinary URL", type: "url" }),
                defineField({ name: "width", title: "Width (px)", type: "number" }),
                defineField({ name: "height", title: "Height (px)", type: "number" }),
                defineField({ name: "alt", title: "Alt Text", type: "localizedString" }),
                defineField({ name: "caption", title: "Photo Caption", type: "localizedString" }),
                defineField({
                  name: "credit",
                  title: "Photo Credit (set by the image finder)",
                  type: "object",
                  fields: [
                    defineField({ name: "author", title: "Author", type: "string" }),
                    defineField({ name: "license", title: "Licence", type: "string" }),
                    defineField({ name: "licenseUrl", title: "Licence URL", type: "url" }),
                    defineField({ name: "sourceUrl", title: "Source page", type: "url" }),
                    defineField({ name: "provider", title: "Provider", type: "string" }),
                    defineField({ name: "required", title: "Licence requires a visible credit", type: "boolean" }),
                  ],
                }),
              ],
            }),
            defineField({
              name: "embeddedPackageSlug",
              title: "Inline Tour Package CTA Slug (e.g. samarkand-day-tour-by-afrosiyob-train)",
              type: "string",
            }),
          ],
        },
      ],
    }),
    defineField({
      name: "relatedPackages",
      title: "Related Tour Package Slugs",
      type: "array",
      group: "sections",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "faqs",
      title: "Article FAQs (3–4 high-intent Q&As)",
      type: "array",
      group: "seo",
      of: [
        {
          type: "object",
          name: "faqItem",
          title: "FAQ Item",
          fields: [
            defineField({ name: "q", title: "Question", type: "localizedString" }),
            defineField({ name: "a", title: "Answer", type: "localizedString" }),
          ],
        },
      ],
    }),
    defineField({
      name: "seo",
      title: "Per-Locale SEO Metadata",
      type: "object",
      group: "seo",
      fields: ["en", "de", "fr", "ja", "es"].map((loc) =>
        defineField({
          name: loc,
          title: `SEO (${loc.toUpperCase()})`,
          type: "object",
          fields: [
            defineField({ name: "seo_title", title: "SEO Title", type: "string" }),
            defineField({ name: "meta_description", title: "Meta Description", type: "text" }),
            defineField({ name: "focus_keyword", title: "Focus Keyword", type: "string" }),
            defineField({
              name: "keywords",
              title: "Keywords",
              type: "array",
              of: [{ type: "string" }],
            }),
            defineField({ name: "og_image", title: "OG Image URL", type: "url" }),
            defineField({ name: "canonical", title: "Canonical URL", type: "url" }),
            defineField({ name: "noindex", title: "Noindex", type: "boolean" }),
          ],
        }),
      ),
    }),
  ],
  preview: {
    select: {
      title: "title.en",
      slug: "slug",
      destination: "destination",
      category: "category",
      published: "published",
    },
    prepare({ title, slug, destination, category, published }) {
      return {
        title: String(title || slug || "Untitled Blog Guide"),
        subtitle: `${published ? "🟢" : "⚪"} ${String(destination || "")} · ${String(category || "guide")}`,
      };
    },
  },
});
