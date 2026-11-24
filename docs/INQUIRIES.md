# Trip inquiries

The Plan-your-trip form (`src/components/InquiryForm.tsx`) posts JSON to
`POST /api/inquiry` (`functions/api/inquiry.ts`, a Cloudflare Pages Function).
Enquiries are stored in Cloudflare D1 (database `sunday-atlas-inquiries`, binding `INQUIRIES_DB`). Supabase is no longer used.

## Flow

1. **Origin check.** Only the apex, `www`, `*.sunday-atlas-travel.pages.dev` and localhost are accepted.
2. **Honeypot.** If the hidden `website` field is filled, the function answers `ok` and saves nothing.
3. **Validation.** Same limits as the table checks. Consent must be true, and the locale must be one of en/de/fr/ja/es.
4. **Rate limit.** KV `CHAT_RL`, keys `inq:10m:<ip>:<bucket>` (3 per 10 min) and `inq:d:<ip>:<day>` (10 per day). Over the limit, it returns `429 rate_limited`.
5. **Turnstile.** The function calls Cloudflare `siteverify` with `TURNSTILE_SECRET_KEY`, the token, `remoteip` (CF-Connecting-IP) and an idempotency key. The hostname must be the apex or `www` and the action `inquiry`. Otherwise it returns `403 challenge` and nothing is saved or sent. It fails closed: a missing secret gives `503 not_configured`. The widget (`src/components/TurnstileWidget.tsx`) is explicitly rendered in Managed mode, size flexible, in the page language. Its public sit6. **Save (D1, 5 s timeout).** `INSERT` into the D1 table `inquiries` (binding `INQUIRIES_DB`). A failure or timeout is logged as `inquiry_save_failed` (status only) and does not stop the email.
7. **Email (always attempted).** It calls the `INQUIRY_MAIL` service binding, which is the Worker `workers/inquiry-mail` with a Cloudflare Email Routing `send_email` binding. The mail Worker has no database dependency.
   - From `inquiries@sundayatlastravel.com` to the verified destination `contact@sundayatlastravel.com`.
   - Reply-To is the visitor's email.
   - Subject: `Trip inquiry: <name> · <destination> · <package|no package> · <dates>`. If the D1 save failed, the subject starts with `[DB save failed]` and the body says the email is the only copy, with the full enquiry.
   - When the row was saved, the result goes into it (`email_status` = `sent` or `failed`, plus `email_error` and `email_sent_at`).
8. **Acknowledgement.** Saved rows also send the acknowledgement above (From/Reply-To `contact@sundayatlastravel.com`, display name `Sunday Atlas Travel`, subject `We received your trip enquiry`) through the same `INQUIRY_MAIL` worker on binding `EMAIL_ACK`. Names that start with `TEST` skip it. Failure is logged as `inquiry_ack_failed` and does not change `email_status` or the HTTP result.
9. **Response.** `ok` when either the save or the email succeeded; `502 error` only when both failed. Logs carry event names, status, row id and booleans only, never names, emails or messages.

to the visitor, because the row is saved. Check the rows where `email_status <> 'sent'`.

The form shows localized messages for success, invalid input, rate limiting, a generic error and not configured (`contact.*` in `src/i18n/dictionaries/*.json`).

## Configuration

- **`wrangler.toml` (Pages):** `CHAT_RL` KV, `[[services]] INQUIRY_MAIL → sunday-atlas-inquiry-mail`, and `[[d1_databases]] INQUIRIES_DB → sunday-atlas-inquiries` (id `f8bae59c-8246-4f5c-9587-fa2722e5ff7a`), for production and preview.
- **Schema:** `migrations/` (D1). Apply new migrations with `npx wrangler d1 migrations apply sunday-atlas-inquiries --remote`.
- **Pages secret:** `TURNSTILE_SECRET_KEY` (missing gives `503 not_configured`).
- **Mail Worker:** deploy with `cd workers/inquiry-mail && npx wrangler@4 deploy`. wrangler@3 ignores `allowed_sender_addresses`. The Worker has no public route (`workers_dev = false`).
- **Acknowledgement deploy:** This task does not deploy. Production ack works only after both deploys. Pages CI (`.github/workflows/deploy-pages.yml`) deploys functions on push to `main` and does not deploy `workers/inquiry-mail`. Deploy the worker by hand from `workers/inquiry-mail`: `npx wrangler@4 deploy` (wrangler 3 ignores `allowed_sender_addresses`). Do that immediately after merge, before or while the Pages deploy runs. Until that worker deploy, the live worker ignores `to` / `from` / `html`. An ack POST still has `subject` and `text`, so the old worker would send the acknowledgement text to `contact@sundayatlastravel.com` from `inquiries@`. Team notification itself is unchanged. Deploying the worker first is safe: omitted fields still mean team mail, and no ack is sent until the new Pages function is live. Do not add a Brevo secret. Do not change dashboard Email Routing by hand for this task. Do not add an `addresses` list (that would create inbound routing rules on deploy).
- **Legacy, unused:** Pages secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INQUIRY_DB_TOKEN`, GitHub secrets `NEXT_PUBLIC_SUPABASE_*`, and `supabase/migrations/` (history only). They can be removed later.
- **Local test:** `npm run test:inquiry` (mocked captcha and mail, real schema in in-memory SQLite).

## Reading inquiries

See `docs/INQUIRIES-D1.md` for the commands. Every enquiry also arrives by email in contact@sundayatlastravel.com; reply directly (Reply-To is the visitor).
