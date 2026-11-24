# Architecture

The sections below describe the tree, dictionaries, content JSON, and build.

## Structure

```
app/                                              Next.js App Router. Static export.
  globals.css                                     Tailwind layers and base styles (focus ring, type).
  layout.tsx                                      Pass-through root layout. Does not render <html> or <body>.
  page.tsx                                        `/` document that meta-refreshes to `/en/`.
  not-found.tsx                                   Global 404 with its own English document shell.
  [locale]/                                       One segment per locale: en, de, fr, ja, es, zh.
    layout.tsx                                    Locale <html lang>, fonts, header, footer, AI chat, WhatsApp, title template.
    page.tsx                                      Homepage: hero, destination cards, package cards.
    about/page.tsx                                About prose from the dictionary.
    contact/page.tsx                              Contact page and the inquiry form.
    faq/page.tsx                                  FAQ from the dictionary.
    how-it-works/page.tsx                         How-it-works steps from the dictionary.
    privacy/page.tsx                              Privacy prose from the dictionary.
    terms/page.tsx                                Terms prose from the dictionary.
    destinations/page.tsx                         Index of published destinations.
    destinations/[country]/page.tsx               One destination plus its packages. Param is the destination slug.
    packages/page.tsx                             Index of published packages.
    packages/[slug]/page.tsx                      One package: itinerary, included, price note.

src/                                              Shared code imported by the App Router.
  components/Breadcrumbs.tsx                      Breadcrumb nav used on destination and package pages.
  components/Cards.tsx                            DestinationCard and PackageCard.
  components/Footer.tsx                           Site footer.
  components/Header.tsx                           Site header and mobile nav.
  components/InquiryForm.tsx                      Client inquiry form. Calls submitInquiry.
  components/LanguageSwitcher.tsx                 Switches the locale segment and keeps the rest of the path.
  components/Logo.tsx                             Compass mark and wordmark.
  components/ProsePage.tsx                        Shared layout for about, privacy, and terms.
  components/TopoBackdrop.tsx                     Decorative contour lines on the homepage hero.
  components/WhatsAppSlot.tsx                     WhatsApp link. Renders nothing unless NEXT_PUBLIC_WHATSAPP_NUMBER is set.
  components/chat/ChatLauncher.tsx                Floating assistant bubble. Lazy-loads the chat panel.
  components/chat/ChatPanel.tsx                   Assistant dialog. Posts to /api/chat.
  components/seo/JsonLd.tsx                       JSON-LD <script>. Renders nothing when data is omitted.
  config/site.ts                                  Site name and siteUrl (NEXT_PUBLIC_SITE_URL).
  i18n/config.ts                                  Locales, default locale en, endonyms, isLocale.
  i18n/getDictionary.ts                           Loads a locale dictionary and merges English fallback.
  i18n/dictionaries/en.json                       English source dictionary. _status is "source".
  i18n/dictionaries/de.json                       German dictionary. _status is "translated".
  i18n/dictionaries/fr.json                       French dictionary. _status is "translated".
  i18n/dictionaries/ja.json                       Japanese dictionary. _status is "translated".
  i18n/dictionaries/es.json                       Spanish dictionary. _status is "translated".
  lib/content.ts                                  Reads content JSON and exports Destination and TravelPackage types.
  lib/inquiry.ts                                  submitInquiry. Returns not_configured until Supabase is wired.
  lib/metadata.ts                                 buildPageMetadata. Canonical, hreflang, Open Graph and Twitter images, robots index gate.
  lib/paths.ts                                    swapLocale and {placeholder} fill.

content/                                          English-only journey copy. Not localised.
  destinations/{kazakhstan,kyrgyzstan,uzbekistan,tajikistan,turkmenistan}.json   Published Central Asia destinations.
  packages/3-stans-discovery-14-days.json         Published tour (KZ, KG, UZ), 14 days.
  packages/four-stans-odyssey-18-days.json        Published tour (KZ, KG, TJ, UZ), 18 days.
  packages/five-stans-long-road-22-days.json      Published tour (all five Stans), 22 days.
  destinations/bhutan.json, packages/bhutan-7-day-cultural-journey.json, packages/kyrgyzstan-8-day-nomad-trails.json
                                                  Old samples: published false, noindex, kept on disk; their URLs 301 to /{locale}/packages/ (public/_redirects).

public/                                           Files copied into the static export as-is.
  _redirects                                      Cloudflare Pages: `/` → `/en/` with a 302.
  favicon.svg                                     Site icon.
```

## Dictionaries

Exact files:

- `src/i18n/dictionaries/en.json`
- `src/i18n/dictionaries/de.json`
- `src/i18n/dictionaries/fr.json`
- `src/i18n/dictionaries/ja.json`
- `src/i18n/dictionaries/es.json`

`src/i18n/getDictionary.ts` types `Dictionary` as `typeof en`. `getDictionary(locale)` returns `getDictionarySync`. For `en` that is the English object unchanged. For `de`, `fr`, `ja`, and `es` it runs `deepMerge(en, dictionaries[locale])`.

Merge rules in `deepMerge`:

- Walk only keys that exist on the English object. Extra keys on a locale file are dropped.
- A missing key (`undefined`) or `""` keeps the English value, including a whole nested object or array. An unfinished translation cannot blank a label.
- A non-empty string, number, or boolean replaces the English leaf.
- Nested objects merge key by key.
- An array is replaced as a whole when the locale value is present. An empty array replaces the English array. Omit the key, or set it to `""`, to keep the English array.

How to add a key:

1. Add it to `en.json` first. That updates the `Dictionary` type.
2. Add the same path to `de.json`, `fr.json`, `ja.json`, and `es.json` when you have a translation. Until then, omit the key or use `""` so English shows through.
3. Read copy with `getDictionary(locale)` (or `getDictionarySync`). Do not import a locale JSON from a page.

`_status` is a top-level string marker. It is not rendered. `en.json` has `"_status": "source"`. `de.json`, `fr.json`, `ja.json`, and `es.json` each have `"_status": "translated"`. `npm run check:i18n` checks that those four files match the English key structure.

## Content shape

Types live in `src/lib/content.ts`. Files are `content/destinations/*.json` and `content/packages/*.json`. `getDestinations` and `getPackages` drop entries where `published` is not `true`, then sort by `name` or `title`. `TravelPackage.destination` is the destination `slug` (e.g. `"kazakhstan"`); `countries` lists every destination slug the tour visits. `getPackagesByDestination` matches either, so destinations and tours link both ways.

`Destination`:

| Field | Type |
| --- | --- |
| `slug` | `string` |
| `name` | `string` |
| `region` | `string` |
| `summary` | `string` |
| `bestSeasons` | `string[]` |
| `highlights` | `string[]` |
| `visaNote` | `string` |
| `heroGradient` | `[string, string]` (two CSS colors) |
| `image` | `LocalizedImage` (`src`, `width`, `height`, `alt` in en, de, fr, ja, es) |
| `sample` | `boolean` |
| `published` | `boolean` |

`TravelPackage`:

| Field | Type |
| --- | --- |
| `slug` | `string` |
| `title` | `string` |
| `destination` | `string` (destination slug) |
| `durationDays` | `number` |
| `style` | `string` |
| `summary` | `string` |
| `itinerary` | `ItineraryDay[]` |
| `included` | `string[]` |
| `notIncluded` | `string[]` |
| `priceFrom` | `number \| null` |
| `currency` | `string \| null` |
| `priceNote` | `string` |
| `image` | `LocalizedImage` (`src`, `width`, `height`, `alt` in en, de, fr, ja, es) |
| `sample` | `boolean` |
| `published` | `boolean` |

`ItineraryDay`: `day` is `number`, `title` is `string`, `description` is `string`.

The three tours carry `priceFrom`, `currency: "USD"`, `fromLabel`, a `priceTable` (season 2027, USD per person, twin share, with single supplement), `hotels`, `vehicles`, `changeNote` and per-day meals; see `src/lib/content.ts` for the full types. `sample` is legacy and ignored by the UI. The old samples are `published: false`.

Optional package fields. Leave one out and that block stays hidden, so existing tours render as before.

- `seasonNote` is a localized string (`en`, and optional `de`, `fr`, `ja`, `es`). Text adds an At a glance Season card. English fills an empty locale.
- `maxGroupSize` is a number. A value of 1 or more adds an At a glance Group size card, “Private tour, up to {n} travellers” (translated).
- `nights` of `0`, or nights omitted, never prints “0 nights”. `durationDays: 1` in that case uses the singular “{days} day” label on the package page and on package cards.
- `addOns` is an array of package slugs. Published packages render immediately after the price table, before included and hotels. Optional `headings.addOns` (localized, this locale only) replaces the dictionary H2. Unknown, unpublished, and self slugs are skipped.
- `priceTable.rows[].singleSupplement` is shown verbatim when set (for example `+390`). An empty string shows “On request” in that cell.
- TouristTrip JSON-LD is unchanged: the Offer still uses `priceFrom` and `currency`. `maxGroupSize` is not emitted. `durationDays` 1 with `nights` 0 keeps the same schema shape.

## Build commands

From the repo root:

```
npm install
npm run dev          # next dev
npm run typecheck    # tsc --noEmit
npm run build        # next build, static export to out/
```

`next.config.mjs` sets `output: "export"` and `trailingSlash: true`. `npm run build` writes the site to `out/`. Preview that folder locally with:

```
npx serve out
```

`/` in the export refreshes to `/en/`. Cloudflare Pages also reads `public/_redirects`.

## SEO

- Sitemap, robots, JSON-LD, canonical URLs, and hreflang (including `x-default`) are implemented. See `app/sitemap.ts`, `app/robots.ts`, and `src/lib/structured-data.ts`. Canonical and hreflang are set in `src/lib/metadata.ts` (`buildPageMetadata`), which every page calls with `locale` and a locale-agnostic `path`.
- The document title template is `%s | Sunday Atlas Travel`, set on `app/[locale]/layout.tsx`.
- `NEXT_PUBLIC_SITE_URL` defaults to `https://sundayatlastravel.com` (see the README). Canonicals, hreflang, and the sitemap keep using this origin.
- `NEXT_PUBLIC_INDEXABLE` gates indexing. It is on only when the value is the string `true` (`isIndexable` in `src/config/site.ts`). Set it true ONLY on the production build when `NEXT_PUBLIC_SITE_URL` is the final domain. Previews and `*.pages.dev` stay noindex. When it is off, `robots.txt` is `User-agent: *` / `Disallow: /` and pages emit `noindex, nofollow`. When it is on, crawlers may index `/` except `/admin/`, and pages emit `index, follow`. On Cloudflare Pages, set `NEXT_PUBLIC_INDEXABLE=true` and the final `NEXT_PUBLIC_SITE_URL` in the Production environment only. Leave the variable unset or `false` for Preview. See `docs/SEO.md`.

## Translations

- `de`, `fr`, `ja`, and `es` are fully translated. Each file has `_status`: `translated`.
- `npm run check:i18n` verifies parity with `en.json` (keys, types, array lengths, `{placeholder}` tokens, no empty strings, no extra keys).
- Journey JSON in `content/` is English-only.

## Content and inquiries

- Decap CMS edits `content/destinations/*.json` and `content/packages/*.json`. See `docs/CMS.md`. Entries with `published: false` are omitted everywhere (pages, sitemap, chat index). There is no sample badge.
- The inquiry form is described in `docs/INQUIRIES.md`. `submitInquiry` in `src/lib/inquiry.ts` returns `not_configured` until the Supabase URL and anon key are set at build time.
- WhatsApp renders only when `NEXT_PUBLIC_WHATSAPP_NUMBER` is set at build time. Leave it empty to hide the button. The AI chat is on every locale page and posts to `/api/chat`.

## Content rules that stay in force

Do not invent ratings, reviews, testimonials, star scores, prices, statistics, phone numbers, email addresses, street addresses, or partner names. The public email line must stay “contact email coming soon” until a real mailbox exists. Visa notes must not state specific visa rules.
