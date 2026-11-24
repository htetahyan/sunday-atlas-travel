# Sunday Atlas Travel

Sunday Atlas Travel is a multilingual travel website for small-group and private tours across Central Asia, the Caucasus and beyond. The live site is [https://sundayatlastravel.com](https://sundayatlastravel.com).

## Features

- Six locales: English (`en`), German (`de`), French (`fr`), Japanese (`ja`), Spanish (`es`), and Simplified Chinese (`zh`). Chinese covers the tours and destinations that have their own copy.
- Destination and tour pages.
- JSON-LD and other SEO metadata (canonical URLs, hreflang, sitemap, robots).
- AI chat on every locale page.
- Enquiry form with Cloudflare Turnstile, storage in D1, an email notification, and an automatic acknowledgement.
- AI blog pipeline with daily generation and automatic translation.
- Newsletter signup and unsubscribe.
- CMS through Sanity and Decap.

## Tech stack

Next.js static export, TypeScript, and Tailwind CSS. Hosting is Cloudflare Pages with Pages Functions, D1, KV, Workers AI, and Email Workers. Content is edited in Sanity and Decap. GitHub Actions builds and deploys the site.

## Project structure

- `app/` — Next.js App Router pages and the static-export routes.
- `src/` — shared components, locale dictionaries, and content loaders.
- `content/` — destination, tour, and blog JSON.
- `functions/` — Cloudflare Pages Functions (`/api/chat`, `/api/inquiry`, newsletter, translation).
- `workers/` — Email Worker for enquiry mail, and the Decap OAuth proxy.
- `scripts/` — content sync, blog generation, translation, and checks.
- `sanity/` — Sanity schema.
- `docs/` — longer notes. Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the tree, dictionaries, content JSON, and build.

## Getting started

Requires Node.js 20.

```bash
npm ci
npm run dev          # local dev server
npm run build        # static export to out/
npm run typecheck    # tsc --noEmit
npm run test:inquiry # enquiry fail-safe tests
```

## Environment variables

Names only. Set values in your shell, GitHub Actions secrets or variables, or Cloudflare. Do not commit them.

### Site build

| Name | Role |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public origin used for canonical URLs |
| `NEXT_PUBLIC_INDEXABLE` | Allows indexing when set for the production host |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Shows the WhatsApp link when set |
| `NEXT_PUBLIC_SUPABASE_URL` | Legacy public Supabase URL (inlined at build time) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy public Supabase anon key |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | Sanity project |
| `NEXT_PUBLIC_SANITY_DATASET` | Sanity dataset |

### Optional private supplier input

| Name | Role |
| --- | --- |
| `SUPPLIERS_FILE` | Path to private supplier records. Missing file is ignored |
| `SUPPLIER_EXTRA_RE` | Extra name fragments, separated by `\|` or newlines |
| `SUPPLIER_NAMES_FILE` | Optional file of extra name fragments, one per line |

Private supplier records are kept outside this repository.

### GitHub Actions

| Name | Role |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Pages deploy |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account |
| `CLOUDFLARE_AI_API_TOKEN` | Workers AI from the blog workflow |
| `TRANSLATE_SECRET` | Shared secret for `/api/translate` |
| `TRANSLATE_BASE_URL` | Origin used to call translation |
| `SANITY_API_WRITE_TOKEN` | Sanity writes (blog, newsletter, subscribe secret) |
| `NEWSLETTER_UNSUB_SECRET` | Unsubscribe link signing |
| `NEWSLETTER_ENABLED` | Allows a newsletter send |
| `BREVO_API_KEY` | Newsletter delivery |
| `NVIDIA_API_KEY` | Blog and Chinese translation models |
| `BLOG_NVIDIA_TEXT_MODELS` | Optional text-model list |
| `BLOG_NVIDIA_TRANSLATE_MODELS` | Optional translation-model list |
| `BLOG_AI_URL` | Blog AI endpoint |
| `CLOUDINARY_URL` | Image hosting for generated posts |
| `PEXELS_API_KEY` | Stock image search |
| `UNSPLASH_ACCESS_KEY` | Stock image search |

### Pages Functions

Secrets: `TURNSTILE_SECRET_KEY`, `SANITY_SUBSCRIBE_TOKEN`, `SANITY_PROJECT_ID`, `SANITY_DATASET`, `CHAT_MODEL_OVERRIDE`.

Bindings in `wrangler.toml`: `AI`, `CHAT_RL`, `INQUIRIES_DB`, `INQUIRY_MAIL`.

Legacy Pages secrets that the current enquiry path does not use: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INQUIRY_DB_TOKEN`.

## Deployment

A push to `main` runs `.github/workflows/deploy-pages.yml`. That workflow translates changed content, runs `npm ci`, builds the static export, and deploys `out/` with `wrangler pages deploy`. Bindings for Workers AI, KV, D1, and the enquiry mail worker are declared in the root `wrangler.toml`.

The enquiry Email Worker is deployed separately from `workers/inquiry-mail`. `destination_address` must be a verified Cloudflare Email Routing destination.

## License

All rights reserved.
