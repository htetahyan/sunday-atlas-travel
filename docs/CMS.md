# Content editing (Decap CMS)

Journey copy is JSON. English is required. German, French, Japanese, and Spanish are optional:

- `content/destinations/*.json`
- `content/packages/*.json`
- `content/pages/*.json` (SEO fields for static pages, plus optional FAQs on home, destinations, packages, about, and how-it-works)
- `content/settings/seo.json` (site-wide SEO settings)

Decap CMS is a static page at `/admin`. It is not a Next.js route. `public/admin` is copied to `out/admin` by `npm run build`. The page sends `noindex, nofollow`. `robots.txt` also disallows `/admin/`.

There are no secrets in this repo. Do not add a GitHub client secret, a personal access token, or a Supabase service role key.

## Edit on your machine

Use two terminals from the repo root:

```
npm run cms
npm run dev
```

`npm run cms` runs `npx decap-server` (local Git backend, port 8081). `npm run dev` serves the site. Open [http://localhost:3000/admin/](http://localhost:3000/admin/).

`local_backend: true` is not in the committed `public/admin/config.yml`. For local editing, add `local_backend: true` temporarily to your local copy, run `npx decap-server` (`npm run cms`), and never commit that line. Saving writes the JSON files under `content/`. Uploads go to `public/uploads` and are served from `/uploads`. You do not sign in with GitHub for this local path.

What editors need to know:

- The filename comes from the `slug` field. Use lowercase letters, numbers, and hyphens. A package’s destination is that destination’s slug.
- `published` must be true or the site omits the entry. New entries default to unpublished. Unpublished entries have no page, no listing, no sitemap or image-sitemap entry, and no hreflang alternate.
- `sample` is kept for older entries. The site ignores it and does not show a sample badge.
- The visa note must not state specific visa rules. The default is “Check official government sources before travel”.
- Leave **Price from** and **Currency** empty when the price is on request. The site treats an empty value as null. The default price note is “Price on request — we quote every trip personally”. Do not invent a price.
- The hero gradient is exactly two CSS colors.
- **Headings** on a destination or package are optional per locale. Set H1 to include the focus keyword; leave it empty to keep the destination name or package title. Section titles (seasons, highlights, FAQ, packages, facts, itinerary, included, not included, prices, add-ons, hotels, vehicles) fall back to the site dictionary when empty. An English heading does not fill other locales.
- Package **Intro** is an optional lead paragraph above the summary. Put the focus keyword in the first sentence. Leave it empty to hide.
- Destination, package, and selected static pages (home, destinations list, packages list, about, how-it-works) can store optional **FAQs**. Empty lists hide the section. The `/faq/` page still uses the dictionary FAQ and has no CMS list.
- An optional **FAQ title** on home, destinations, packages, about, and how-it-works replaces the dictionary H2 for that locale only. Leave it empty to keep the default. English does not fill other locales.
- Optional **content sections** (H2 plus text) on the home page, the packages list, the destinations list, and the FAQ page render only when that locale has both a heading and a body. On the home page they sit under the featured packages. English does not fill other locales. Leave them empty to hide.

## Multi-country tours

These package fields are optional. Leave one empty and that block stays hidden. Packages that omit them keep the previous layout.

- **Countries** is extra destination slugs, beside the primary **Destination**. The package is listed on every published country in that set. A country link is shown only when that destination is published. An unpublished primary destination does not hide the package page.
- **Region** (`region`) is an optional localized string override (for example “Central Asia”). When left empty, the package automatically inherits its geographical region(s) from its **Destination** and **Countries** for filtering on `/packages/`.
- **Day tour** (`isDayTour`) is an optional boolean toggle. When enabled (or when `durationDays` is `1` and `isDayTour` is omitted), the package is categorized as a Day tour in the `/packages/` filter bar and displays a Day tour badge on its card.
- **Featured on homepage** (`featured`) is an optional boolean toggle. When enabled on one or more published packages, the homepage Featured Packages section shows those featured tours while `/packages/` lists all published tours with filtering and pagination.
- **Nights**, when set to 1 or more, shows “{days} days / {nights} nights”. `0` or an empty value never prints “0 nights”. A one-day trip (`durationDays` 1 with nights empty or 0) uses the singular “{days} day” label on the package page and on package cards.
- **Season note** (`seasonNote`) is a localized string. When that locale has text, At a glance shows a Season card. Leave every locale empty to hide the card. English fills a missing translation, like other body fields.
- **Maximum group size** (`maxGroupSize`) is an optional integer. When it is 1 or more, At a glance shows Group size as “Private tour, up to {n} travellers” (translated). Leave it empty to hide the card.
- **Add-on trips** (`addOns`) is an optional list of package slugs. Published matches render just after the price table (before included and hotels) under `headings.addOns`, or the dictionary title when that heading is empty. Unknown, unpublished, and self slugs are skipped. The heading is per locale and does not fall back to English.
- Each itinerary day can set **Meals**, shown as written (for example “Breakfast, lunch”).
- **Price label** (`fromLabel`) is shown verbatim, for example `from $2643 per person (10–11 travellers, 3*)`. Leave it empty for “Price on request”.
- **Price table** has a caption, group-size column headers, rows, and a note. A row has a label (for example “Hotels 3*”), one price number per column, and a single-supplement string such as `+390`. An empty single supplement shows “On request”. The site prints each price with a leading `$` and the digits as stored. It does not add thousands separators, round, or calculate a total.
- **Hotels** lists city, 3* hotels, and 4* hotels. **Vehicles** lists group size and vehicle.
- **Change note** is the disclaimer under the itinerary. **Train note** is the footnote under the included list.

Refresh the dev site after saving. Production needs a new build and deploy before the committed JSON appears.

## Production sign-in

`config.yml` sets the GitHub backend to `htetahyan/rare-atlas-travel`, branch `main`. On the deployed site, a save commits to that branch. GitHub will not accept the login until an OAuth client exists outside this repo. Pick one of the two setups below.

### GitHub OAuth App and a Cloudflare Worker proxy

Use this with Cloudflare Pages.

1. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps). Set the callback URL to the proxy’s callback (often `/callback` on the worker).
2. Deploy a free Cloudflare Worker that speaks Decap’s OAuth endpoints, for example a `decap-proxy` worker. Store the OAuth client id and client secret as worker configuration. The secret stays out of git.
3. In `public/admin/config.yml`, uncomment `base_url` (the worker origin, no path) and `auth_endpoint` (`auth`). Those values are public. Commit them. Do not commit the client secret.
4. Redeploy the site so `/admin/config.yml` updates.

Editors then open `https://<the-site>/admin/` and sign in with GitHub. The account needs permission to push to `main`.

### Netlify Identity and git-gateway

`config.yml` has a commented `name: git-gateway` alternative. That path is for Netlify Identity. This site is deployed on Cloudflare Pages, so git-gateway is not the production backend. Leave it commented unless the host changes to Netlify.

## Suppliers (private)

Private supplier records are kept outside this repository. They are never stored on package or destination content.
