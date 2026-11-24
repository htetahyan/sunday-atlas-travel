import { defineField, defineType } from "../lib/define";

export const SUPPORTED_LOCALES: ReadonlyArray<{
  id: string;
  title: string;
  isDefault: boolean;
}> = [
  { id: "en", title: "English (Required)", isDefault: true },
  { id: "de", title: "German (Deutsch)", isDefault: false },
  { id: "fr", title: "French (Français)", isDefault: false },
  { id: "ja", title: "Japanese (日本語)", isDefault: false },
  { id: "es", title: "Spanish (Español)", isDefault: false },
  // zh is filled by the zh-translate workflow (scripts/zh-translate-next.mjs); a page is live in zh once
  // its title/name and summary have zh.
  { id: "zh", title: "Simplified Chinese (简体中文)", isDefault: false },
];

export const localizedString = defineType({
  name: "localizedString",
  title: "Localized String",
  type: "object",
  fieldsets: [
    {
      name: "translations",
      title: "Translations (DE, FR, JA, ES, ZH)",
      options: { collapsible: true, collapsed: false },
    },
  ],
  fields: SUPPORTED_LOCALES.map((locale) =>
    defineField({
      name: locale.id,
      title: locale.title,
      type: "string",
      ...(locale.isDefault ? {} : { fieldset: "translations" }),
    }),
  ),
});

export const localizedStringArray = defineType({
  name: "localizedStringArray",
  title: "Localized String List",
  type: "object",
  fieldsets: [
    {
      name: "translations",
      title: "Translations (DE, FR, JA, ES, ZH)",
      options: { collapsible: true, collapsed: true },
    },
  ],
  fields: SUPPORTED_LOCALES.map((locale) =>
    defineField({
      name: locale.id,
      title: locale.title,
      type: "array",
      of: [{ type: "string" }],
      ...(locale.isDefault ? {} : { fieldset: "translations" }),
    }),
  ),
});
