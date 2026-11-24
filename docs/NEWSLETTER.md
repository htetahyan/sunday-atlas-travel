# Weekly newsletter

One email per subscriber per ISO week (Thursday 09:00 Dubai), from `contact@sundayatlastravel.com`,
signed "Jeremy, Sunday Atlas Travel (Bangkok)".

## What is in it

- **Tour of the week**: one package, rotated (`content/newsletter-state.json`). No package repeats until
  every live, priced package with an image has been featured once; then a new cycle starts. A package
  whose destination had blog posts in the last 7 days wins, multi-day tours before day trips.
  Name, duration, `from $X` (catalog `priceFrom` only), its existing Cloudinary photo (delivered as a
  JPEG crop for email; the stored image is unchanged), 2–3 itinerary highlights and a button to the
  package page with `utm_source=newsletter&utm_medium=email&utm_campaign=weekly-<week>`.
- **3 newest travel blog posts** with thumbnails and links.
- Sign-off, reply prompt, Bangkok footer, unsubscribe link.
- Localized in the subscriber's language (en/de/fr/ja/es, fallback en). Tour and blog text come from
  the already translated catalog; the email frame strings are in `scripts/lib/newsletter-core.mjs`.
- Brand checks before anything is sent: banned words, supplier names, unfilled placeholders.

## Exactly one per week

`scripts/newsletter.mjs --send`, per subscriber:
1. skip if `unsubscribed == true`, `lastSentWeek == <week>` or `lastAttemptWeek == <week>`;
2. claim with a Sanity patch `lastAttemptWeek=<week>` using `ifRevisionID` (a parallel run loses);
3. send through Brevo (`POST https://api.brevo.com/v3/smtp/email`) with `List-Unsubscribe` and
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click`;
4. record `lastSentWeek`, `lastSentAt`, `lastMessageId`.
A definite API rejection releases the claim; a timeout keeps it, so nobody is ever sent twice.
The workflow also has `concurrency: newsletter`. Cap 280 sends per run (Brevo free = 300/day).

## Unsubscribe

`/api/unsubscribe?id=<sha id>&t=<hmac>&l=<locale>` (`functions/api/unsubscribe.ts`).
- GET shows a localized page with one button (GET never changes data, so link scanners can't unsubscribe anyone).
- POST (the button, or the inbox "Unsubscribe" one-click) sets `unsubscribed=true`, `unsubscribedAt`.
- Token = HMAC-SHA256(`NEWSLETTER_UNSUB_SECRET`, `unsub:subscribers.<id>`), base64url, 32 chars.

## Secrets and switches

| Name | Where | Purpose |
|---|---|---|
| `BREVO_API_KEY` | GitHub secret | Brevo > SMTP & API > API keys |
| `NEWSLETTER_UNSUB_SECRET` | GitHub secret, synced to Pages by deploy-pages.yml | signs/verifies unsubscribe links |
| `SANITY_API_WRITE_TOKEN` | GitHub secret | subscribers |
| `NEWSLETTER_ENABLED` | GitHub repo **variable** | must be `true` for any real send |

## Commands

- Preview: `node scripts/newsletter.mjs --dry-run --out=/tmp/nl` (or Actions > Weekly newsletter > mode=preview).
- Test: Actions > Weekly newsletter > mode=test (only `@sundayatlastravel.com` recipients).
- Switch on: `gh variable set NEWSLETTER_ENABLED --body true`. Off: `--body false`.
- Tests: `node scripts/test-newsletter.mjs`.
