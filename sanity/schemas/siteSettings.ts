import { defineField, defineType } from "../lib/define";

export const siteSettings = defineType({
  name: "siteSettings",
  title: "Site & SEO Settings",
  type: "document",
  fields: [
    defineField({
      name: "settingKey",
      title: "Setting Key",
      type: "string",
      initialValue: "seo",
    }),
    defineField({
      name: "title_template",
      title: "Title Template (%s | Sunday Atlas Travel)",
      type: "localizedString",
    }),
    defineField({
      name: "default_description",
      title: "Default Meta Description",
      type: "localizedText",
    }),
    defineField({
      name: "default_keywords",
      title: "Default Keywords",
      type: "localizedStringArray",
    }),
    defineField({
      name: "contact_email",
      title: "Public Contact Email",
      type: "string",
    }),
    defineField({
      name: "organization_logo",
      title: "Organization Logo URL",
      type: "url",
    }),
    defineField({
      name: "google_site_verification",
      title: "Google Search Console Verification Token",
      type: "string",
    }),
    defineField({
      name: "bing_site_verification",
      title: "Bing Webmaster Verification Token",
      type: "string",
    }),
    defineField({
      name: "turnstile_site_key",
      title: "Cloudflare Turnstile Public Site Key",
      type: "string",
    }),
    defineField({
      name: "social",
      title: "Social Profile URLs",
      type: "object",
      fields: [
        defineField({ name: "x", title: "X (Twitter)", type: "url" }),
        defineField({ name: "instagram", title: "Instagram", type: "url" }),
        defineField({ name: "facebook", title: "Facebook", type: "url" }),
        defineField({ name: "youtube", title: "YouTube", type: "url" }),
        defineField({ name: "tiktok", title: "TikTok", type: "url" }),
        defineField({ name: "linkedin", title: "LinkedIn", type: "url" }),
        defineField({ name: "trustpilot", title: "Trustpilot", type: "url" }),
      ],
    }),
    defineField({
      name: "analytics",
      title: "Analytics Configuration",
      type: "object",
      fields: [
        defineField({
          name: "provider",
          title: "Provider (none | ga4 | cloudflare)",
          type: "string",
        }),
        defineField({ name: "id", title: "Measurement / Beacon ID", type: "string" }),
      ],
    }),
  ],
});
