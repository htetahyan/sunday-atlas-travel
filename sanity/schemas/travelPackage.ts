import { defineField, defineType } from "../lib/define";

export const travelPackage = defineType({
  name: "travelPackage",
  title: "Tour Package",
  type: "document",
  groups: [
    { name: "overview", title: "Overview & Facts", default: true },
    { name: "itinerary", title: "Day-by-Day Itinerary" },
    { name: "pricing", title: "Pricing & Inclusions" },
    { name: "logistics", title: "Hotels & Vehicles" },
    { name: "media", title: "Cloudinary Photos" },
    { name: "seo", title: "FAQs, Headings & SEO" },
  ],
  fields: [
    defineField({
      name: "slug",
      title: "URL Slug",
      type: "string",
      group: "overview",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "published",
      title: "Published on live site",
      type: "boolean",
      group: "overview",
      initialValue: true,
    }),
    defineField({
      name: "featured",
      title: "Featured on Homepage",
      type: "boolean",
      group: "overview",
      initialValue: false,
    }),
    defineField({
      name: "isDayTour",
      title: "1-Day Private Excursion (Day Tour Filter)",
      type: "boolean",
      group: "overview",
      initialValue: false,
    }),
    defineField({
      name: "sample",
      title: "Sample / Draft entry",
      type: "boolean",
      group: "overview",
      initialValue: false,
    }),
    defineField({
      name: "title",
      title: "Tour Title",
      type: "localizedString",
      group: "overview",
    }),
    defineField({
      name: "destination",
      title: "Primary Destination Slug (e.g. uzbekistan)",
      type: "string",
      group: "overview",
    }),
    defineField({
      name: "countries",
      title: "Additional Country Slugs",
      type: "array",
      group: "overview",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "region",
      title: "Geographical Region Override",
      type: "localizedString",
      group: "overview",
    }),
    defineField({
      name: "durationDays",
      title: "Duration (Days)",
      type: "number",
      group: "overview",
      validation: (rule) => rule.required().positive().integer(),
    }),
    defineField({
      name: "nights",
      title: "Nights (omit or 0 for 1-day tours)",
      type: "number",
      group: "overview",
    }),
    defineField({
      name: "maxGroupSize",
      title: "Max Private Group Size",
      type: "number",
      group: "overview",
    }),
    defineField({
      name: "style",
      title: "Travel Style Label",
      type: "localizedString",
      group: "overview",
    }),
    defineField({
      name: "seasonNote",
      title: "Season / Operating Months",
      type: "localizedString",
      group: "overview",
    }),
    defineField({
      name: "summary",
      title: "Card Summary",
      type: "localizedText",
      group: "overview",
    }),
    defineField({
      name: "intro",
      title: "Tour Introduction",
      type: "localizedText",
      group: "overview",
    }),
    defineField({
      name: "itinerary",
      title: "Day-by-Day Itinerary",
      type: "array",
      group: "itinerary",
      of: [
        {
          type: "object",
          name: "itineraryDay",
          title: "Itinerary Day",
          fields: [
            defineField({ name: "day", title: "Day Number", type: "number" }),
            defineField({ name: "title", title: "Day Title", type: "localizedString" }),
            defineField({ name: "description", title: "Day Description", type: "localizedText" }),
            defineField({ name: "meals", title: "Included Meals", type: "localizedString" }),
          ],
        },
      ],
    }),
    defineField({
      name: "priceFrom",
      title: "Starting Price (Numeric, e.g. 756)",
      type: "number",
      group: "pricing",
    }),
    defineField({
      name: "currency",
      title: "Currency (USD)",
      type: "string",
      group: "pricing",
      initialValue: "USD",
    }),
    defineField({
      name: "fromLabel",
      title: "Formatted Price Label (e.g. from $756 per person)",
      type: "localizedString",
      group: "pricing",
    }),
    defineField({
      name: "priceNote",
      title: "Pricing Note",
      type: "localizedText",
      group: "pricing",
    }),
    defineField({
      name: "priceTable",
      title: "Tiered Price Table",
      type: "object",
      group: "pricing",
      fields: [
        defineField({
          name: "rowHeader",
          title: "Row Header Mode (auto | hotels | tourType | option)",
          type: "string",
          initialValue: "auto",
        }),
        defineField({ name: "caption", title: "Table Caption", type: "localizedString" }),
        defineField({
          name: "groupSizes",
          title: "Group Size Columns",
          type: "localizedStringArray",
        }),
        defineField({
          name: "rows",
          title: "Price Rows",
          type: "array",
          of: [
            {
              type: "object",
              name: "priceRow",
              title: "Price Tier Row",
              fields: [
                defineField({ name: "label", title: "Tier / Hotel Label", type: "localizedString" }),
                defineField({
                  name: "prices",
                  title: "Prices (matching Group Size columns)",
                  type: "array",
                  of: [{ type: "number" }],
                }),
                defineField({
                  name: "singleSupplement",
                  title: "Single Supplement (e.g. +390, – or empty for on request)",
                  type: "string",
                }),
              ],
            },
          ],
        }),
        defineField({ name: "note", title: "Table Footnote", type: "localizedText" }),
      ],
    }),
    defineField({
      name: "included",
      title: "What Is Included",
      type: "localizedStringArray",
      group: "pricing",
    }),
    defineField({
      name: "notIncluded",
      title: "What Is Not Included",
      type: "localizedStringArray",
      group: "pricing",
    }),
    defineField({
      name: "hotels",
      title: "Hotels by City",
      type: "array",
      group: "logistics",
      of: [
        {
          type: "object",
          name: "hotelStay",
          title: "Hotel Stay",
          fields: [
            defineField({ name: "city", title: "City", type: "localizedString" }),
            defineField({ name: "standard", title: "Standard (3★)", type: "localizedString" }),
            defineField({ name: "superior", title: "Superior (4★)", type: "localizedString" }),
          ],
        },
      ],
    }),
    defineField({
      name: "vehicles",
      title: "Vehicles by Group Size",
      type: "array",
      group: "logistics",
      of: [
        {
          type: "object",
          name: "vehicleOption",
          title: "Vehicle Option",
          fields: [
            defineField({ name: "group", title: "Group Size", type: "localizedString" }),
            defineField({ name: "vehicle", title: "Vehicle Description", type: "localizedString" }),
          ],
        },
      ],
    }),
    defineField({
      name: "changeNote",
      title: "Itinerary / Hotel Change Note",
      type: "localizedText",
      group: "logistics",
    }),
    defineField({
      name: "trainNote",
      title: "Train / Domestic Flight Note",
      type: "localizedText",
      group: "logistics",
    }),
    defineField({
      name: "addOns",
      title: "Optional Add-on Package Slugs",
      type: "array",
      group: "logistics",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "image",
      title: "Hero Image (Cloudinary URL)",
      type: "object",
      group: "media",
      fields: [
        defineField({ name: "src", title: "Cloudinary URL", type: "url" }),
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
      title: "Tour FAQs",
      type: "array",
      group: "seo",
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
      group: "seo",
      fields: [
        "h1",
        "facts",
        "itinerary",
        "included",
        "notIncluded",
        "prices",
        "addOns",
        "hotels",
        "vehicles",
        "faq",
      ].map((key) =>
        defineField({ name: key, title: `Heading: ${key}`, type: "localizedString" }),
      ),
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
      title: "title.en",
      slug: "slug",
      destination: "destination",
      durationDays: "durationDays",
      priceFrom: "priceFrom",
      published: "published",
    },
    prepare({ title, slug, destination, durationDays, priceFrom, published }) {
      const priceLabel = typeof priceFrom === "number" ? `$${priceFrom}` : "On request";
      return {
        title: String(title || slug || "Untitled Package"),
        subtitle: `${published ? "🟢" : "⚪"} ${String(destination || "")} · ${String(durationDays || 1)}d · ${priceLabel}`,
      };
    },
  },
});
