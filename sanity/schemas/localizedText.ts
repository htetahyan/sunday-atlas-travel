import { defineField, defineType } from "../lib/define";
import { SUPPORTED_LOCALES } from "./localizedString";

export const localizedText = defineType({
  name: "localizedText",
  title: "Localized Multiline Text",
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
      type: "text",
      options: { rows: 4 },
      ...(locale.isDefault ? {} : { fieldset: "translations" }),
    }),
  ),
});
