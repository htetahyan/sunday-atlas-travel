import { defineField, defineType } from "../lib/define";

/**
 * PRIVATE supplier record for one tour package. Never add these fields to `travelPackage`:
 * the production dataset is public, so any field on a package document is readable by anyone.
 * Documents of this type use _id "suppliers.<package-slug>". Sanity never serves documents whose
 * _id contains a "." to unauthenticated readers, and scripts/sync-from-sanity.mjs never pulls this type.
 * Written by scripts/sanity-push-suppliers.mjs from the optional private suppliers file
 * kept outside this repository.
 */
export const packageSupplier = defineType({
  name: "packageSupplier",
  title: "Package supplier (private)",
  type: "document",
  description:
    "PRIVATE. Do not create these by hand in Studio (a random _id would be public). Edit the private suppliers file outside this repository and run `npm run suppliers:push`.",
  fields: [
    defineField({ name: "packageSlug", title: "Package slug", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "supplierKey", title: "Supplier key", type: "string" }),
    defineField({ name: "name", title: "Supplier name ('Unknown – check' if not confirmed)", type: "string" }),
    defineField({ name: "contact", title: "Supplier contact / website", type: "string" }),
    defineField({ name: "source", title: "Source doc or listing", type: "string" }),
    defineField({ name: "priceRule", title: "Pricing note", type: "string" }),
    defineField({ name: "evidence", title: "Evidence (where this was confirmed)", type: "text" }),
    defineField({ name: "syncedAt", title: "Last synced", type: "datetime" }),
  ],
});
