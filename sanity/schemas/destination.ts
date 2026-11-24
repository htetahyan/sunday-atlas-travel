import { defineField, defineType } from "../lib/define";

export const destination = defineType({
  name: "destination",
  title: "Destination Country",
  type: "document",
  groups: [
    { name: "editorial", title: "Editorial Copy", default: true },
    { name: "media", title: "Cloudinary Photos & Hero" },
    { name: "faqs", title: "FAQs & Headings" },
    { name: "seo", title: "SEO & Publishing" },
  ],
  fields: [
    defineField({
      name: "slug",
      title: "URL Slug (e.g. uzbekistan)",
      type: "string",
      group: "editorial",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "published",
      title: "Published on live site",
      type: "boolean",
      group: "seo",
      initialValue: true,
    }),
    defineField({
      name: "sample",
      title: "Sample / Draft entry",
      type: "boolean",
      group: "seo",
      initialValue: false,
    }),
    defineField({
      name: "name",
      title: "Country Name",
      type: "localizedString",
      group: "editorial",
    }),
    defineField({
      name: "region",
      title: "Geographical Region",
      type: "localizedString",
      group: "editorial",
    }),
    defineField({
      name: "summary",
      title: "Card Summary",
      type: "localizedText",
      group: "editorial",
    }),
    defineField({
      name: "intro",
      title: "Destination Page Intro",
      type: "localizedText",
      group: "editorial",
    }),
    defineField({
      name: "bestSeasons",
      title: "Best Seasons",
      type: "localizedStringArray",
      group: "editorial",
    }),
    defineField({
      name: "highlights",
      title: "Country Highlights",
      type: "localizedStringArray",
      group: "editorial",
    }),
    defineField({
      name: "visaNote",
      title: "Visa & Entry Note",
      type: "localizedText",
      group: "editorial",
    }),
    defineField({
      name: "heroGradient",
      title: "Hero Gradient Pair (Hex Colors)",
      type: "array",
      group: "media",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "image",
      title: "Hero Image (Cloudinary URL)",
      type: "object",
      group: "media",
      fields: [
        defineField({ name: "src", title: "Image URL", type: "url" }),
        defineField({ name: "width", title: "Width (px)", type: "number" }),
        defineField({ name: "height", title: "Height (px)", type: "number" }),
        defineField({ name: "alt", title: "Alt Text", type: "localizedString" }),
      ],
    }),
    defineField({
      name: "gallery",
      title: "Photo Gallery",
      type: "array",
      group: "media",
      of: [
        {
          type: "object",
          name: "galleryFrame",
          title: "Gallery Frame",
          fields: [
            defineField({
              name: "image",
              title: "Image Asset",
              type: "object",
              fields: [
                defineField({ name: "src", title: "Cloudinary URL", type: "url" }),
                defineField({ name: "width", title: "Width (px)", type: "number" }),
                defineField({ name: "height", title: "Height (px)", type: "number" }),
              ],
            }),
            defineField({ name: "alt", title: "Alt Text", type: "localizedString" }),
          ],
        },
      ],
    }),
    defineField({
      name: "faqs",
      title: "Destination FAQs",
      type: "array",
      group: "faqs",
      of: [
        {
          type: "object",
          name: "faqItem",
          title: "FAQ Item",
          fields: [
            defineField({ name: "q", title: "Question", type: "localizedString" }),
            defineField({ name: "a", title: "Answer", type: "localizedText" }),
          ],
        },
      ],
    }),
    defineField({
      name: "headings",
      title: "Section Heading Overrides",
      type: "object",
      group: "faqs",
      fields: [
        defineField({ name: "h1", title: "H1 Heading", type: "localizedString" }),
        defineField({ name: "seasons", title: "Seasons Heading", type: "localizedString" }),
        defineField({ name: "highlights", title: "Highlights Heading", type: "localizedString" }),
        defineField({ name: "faq", title: "FAQ Heading", type: "localizedString" }),
        defineField({ name: "packages", title: "Packages Heading", type: "localizedString" }),
      ],
    }),
    defineField({
      name: "seo",
      title: "Per-Locale SEO Metadata",
      type: "object",
      group: "seo",
      fields: ["en", "de", "fr", "ja", "es", "zh"].map((loc) =>
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
      title: "name.en",
      slug: "slug",
      region: "region.en",
      published: "published",
    },
    prepare({ title, slug, region, published }) {
      return {
        title: String(title || slug || "Untitled Destination"),
        subtitle: `${published ? "🟢 Published" : "⚪ Draft"} · ${String(region || slug || "")}`,
      };
    },
  },
});
