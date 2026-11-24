import { defineField, defineType } from "../lib/define";

export const staticPage = defineType({
  name: "staticPage",
  title: "Static Page",
  type: "document",
  fields: [
    defineField({
      name: "pageId",
      title: "Page Identifier (home, about, packages, etc.)",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "title",
      title: "Internal Title",
      type: "string",
    }),
    defineField({
      name: "faq_title",
      title: "FAQ Section Heading",
      type: "localizedString",
    }),
    defineField({
      name: "faqs",
      title: "Page FAQs",
      type: "array",
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
      name: "sections",
      title: "Editorial Sections",
      type: "array",
      of: [
        {
          type: "object",
          name: "pageSection",
          title: "Page Section",
          fields: [
            defineField({ name: "heading", title: "Section H2 Heading", type: "localizedString" }),
            defineField({ name: "body", title: "Section Body", type: "localizedText" }),
          ],
        },
      ],
    }),
    defineField({
      name: "seo",
      title: "Per-Locale SEO Metadata",
      type: "object",
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
      title: "title",
      pageId: "pageId",
    },
    prepare({ title, pageId }) {
      return {
        title: String(title || pageId || "Static Page"),
        subtitle: `Page ID: ${String(pageId || "")}`,
      };
    },
  },
});
