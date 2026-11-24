# SEO

Canonical URLs, hreflang, the sitemap, and Open Graph image URLs use `NEXT_PUBLIC_SITE_URL` (no trailing slash). The example value is `https://sundayatlastravel.com`.

`NEXT_PUBLIC_INDEXABLE` gates indexing. The site is indexable only when the value is the string `true`. Any other value, including empty, is noindex.

Set `NEXT_PUBLIC_INDEXABLE=true` only on the production build, and only when `NEXT_PUBLIC_SITE_URL` is the final domain. Preview builds and `*.pages.dev` stay noindex.

When the site is not indexable, `robots.txt` is `User-agent: *` and `Disallow: /`, and pages emit `noindex, nofollow`. When it is indexable, `robots.txt` allows `/`, disallows `/admin/`, lists the sitemap, and pages emit `index, follow, max-image-preview:large, max-snippet:-1`. A locale with `seo.<locale>.noindex` set still emits `noindex, nofollow`, drops out of the sitemap, and is left out of the other locales’ hreflang.

`content/settings/seo.json` holds the title template, default description, default keywords, social profiles, verification tokens, and analytics provider. Empty verification and an empty analytics id emit no tags and load no script. Per-page overrides live on each destination, package, and `content/pages/*.json`. The web app manifest is `app/manifest.ts`.

Destination and package Open Graph images use the hero. A Cloudinary hero is cropped to 1200×630 JPEG (`c_fill,g_auto,w_1200,h_630,f_jpg,q_auto`). A local hero path is prefixed with the site origin. A page with no hero uses the default homepage image.

`public/admin/config.yml` keeps `https://sundayatlastravel.com` as the documented default for `site_url` and `display_url`. After `next build`, `scripts/cms-site-url.mjs` rewrites those two lines in `out/admin/config.yml` from `NEXT_PUBLIC_SITE_URL` (trailing slash removed). The script reads the process environment first and, only if that is unset, `.env.local`, then `.env.production`, then `.env`. It does not print the value. If the variable is still unset, the built file is left unchanged.

## Cloudflare Pages

Set the variables separately for Production and Preview.

- Production: `NEXT_PUBLIC_SITE_URL` is the final domain, and `NEXT_PUBLIC_INDEXABLE=true`.
- Preview: leave `NEXT_PUBLIC_INDEXABLE` unset or set it to `false`. `*.pages.dev` hostnames, including a default production subdomain before the final domain is attached, stay noindex.
