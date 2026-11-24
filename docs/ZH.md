# Simplified Chinese (zh)

`/zh/` is a **partial locale** (hreflang `zh-Hans`, switcher label 中文). Unlike de/fr/ja/es it never
falls back to English: a tour or destination has a `/zh/` page only once its own copy is in Chinese.

## What exists in zh

- Site pages: `/zh/`, about, contact, faq, how-it-works, privacy, terms, destinations, packages.
  Their UI strings are in `src/i18n/dictionaries/zh.json`; their CMS copy (sections, FAQs, SEO) is in
  the `zh` fields of `content/pages/*.json` / Sanity `staticPage`.
- A destination when `name.zh` and `summary.zh` are set; a tour when `title.zh` and `summary.zh`
  are set (`destinationAvailableIn` / `packageAvailableIn` in `src/lib/content.ts`).
- No blog in zh: no `/zh/blog/` pages, no blog link in the zh nav or footer, no blog strips. The chat
  assistant is also off in zh; zh pages point to the enquiry form.

Everything else follows from that rule: static params, lists, related tours, the sitemap, hreflang
alternates, `og:locale:alternate` and llms.txt only include zh URLs that exist. On a page with no zh
version, the language switcher's 中文 entry goes to `/zh/` (home). zh lists say more pages are
being added and link to the English list; an empty zh list links to the enquiry form.

## How items get zh: the queue

`.github/workflows/zh-translate.yml` runs every 3 hours (minute 37 UTC) and translates **one** item
with `scripts/zh-translate-next.mjs`:

1. site pages without zh
2. destinations without zh (most tours first)
3. tours without zh; a tour waits until its countries have zh (that destination goes first), so a
   zh tour page always links to zh destination pages
4. items whose English changed since their zh was written (re-translated)

It translates English → zh with the NVIDIA free API (same client as the daily blog,
`scripts/lib/blog-ai-client.mjs`), Workers AI as fallback. Every string is checked
(`scripts/lib/zh-core.mjs`): Chinese present, numbers / prices / placeholders / URLs unchanged, no
supplier names, no "tailor-made / bespoke / curated" wording (定制, 量身, 精选 …), no reply-time
promises, no Korean/kana/Cyrillic slips, no stale year. If any string fails, nothing is published
for that item; after 3 failed runs it is skipped (`content/zh-status.json` → `failures`) and the
queue moves on.

Never translated or changed: slugs, prices and price tables, numbers, images, private supplier
fields. A "Price on request" tour stays price-free (its zh page uses 价格请咨询).

The zh fields are written to Sanity (one transaction, published and draft copies) and to
`content/`, committed, and a deploy is started. The build's leak guard (`check-supplier-leaks.mjs`)
and placeholder guard (`check-placeholders.mjs`, which also requires Chinese in every `/zh/` title
and h1 and checks that every `/zh/` link exists) run before anything is uploaded.

When every item has zh, a run only checks the queue and stops.

**New tours and destinations need nothing extra.** Publish them as usual; the next runs add zh
(a new tour whose destination already has zh is usually live in zh within about 3 hours).

## Commands

```bash
node scripts/zh-translate-next.mjs --status              # queue, skipped items, estimated finish
node scripts/zh-translate-next.mjs --slug=armenia        # one item now (also pages/<id>)
node scripts/zh-translate-next.mjs --dry-run             # translate and print, write nothing
node scripts/translate-dictionary.mjs --locale=zh        # fill missing UI strings in zh.json
```

In GitHub: Actions → "Chinese (zh) translation queue" → Run workflow (optional `slug`).

Local runs need `NVIDIA_API_KEY` and `SANITY_API_WRITE_TOKEN` in the environment (from files, never
pasted into a command line or log).

## Editing zh by hand

Site pages (home, destinations, packages, …) keep their existing zh SEO title and description when they are re-translated: those are written without tour or destination counts, because the zh lists show only zh items.

Edit the zh field in Sanity Studio ("Simplified Chinese (简体中文)" under Translations). The queue
only rewrites an item's zh when its English changes; to keep a hand-written zh after an English
edit, update `content/zh-status.json` → `items.<folder>/<slug>.source` with the new hash
(`--status` lists stale items). To take an item out of zh, clear its `title`/`name` zh or `summary` zh.
