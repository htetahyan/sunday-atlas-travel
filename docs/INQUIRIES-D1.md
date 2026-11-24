# Reading enquiries from D1

Enquiries from the website form are stored in Cloudflare D1:
database `sunday-atlas-inquiries` (id `f8bae59c-8246-4f5c-9587-fa2722e5ff7a`), table `inquiries`.
Run these from the repo root (`/workspace/site/sunday-atlas-gh`) with the box's existing wrangler login.
Always pass `--remote` (without it wrangler reads an empty local copy).
These rows contain customers' personal data: do not paste them anywhere public.

**List the 20 most recent enquiries**

```bash
npx wrangler d1 execute sunday-atlas-inquiries --remote --command "SELECT created_at, id, name, email, passport_country, destination, package_slug, travel_dates, group_size, email_status FROM inquiries ORDER BY created_at DESC LIMIT 20"
```

**Read one enquiry in full (including the message)**

```bash
npx wrangler d1 execute sunday-atlas-inquiries --remote --command "SELECT * FROM inquiries WHERE id = '<id>'"
```

**Enquiries from the last 7 days**

```bash
npx wrangler d1 execute sunday-atlas-inquiries --remote --command "SELECT created_at, name, email, destination, package_slug, message FROM inquiries WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') ORDER BY created_at DESC"
```

**Enquiries whose notification email failed** (check these by hand)

```bash
npx wrangler d1 execute sunday-atlas-inquiries --remote --command "SELECT created_at, id, name, email, email_error FROM inquiries WHERE email_status <> 'sent' ORDER BY created_at DESC"
```

**Count**

```bash
npx wrangler d1 execute sunday-atlas-inquiries --remote --command "SELECT count(*) AS n FROM inquiries"
```

Add `--json` for machine-readable output. Times are UTC (ISO 8601).

Notes
- If the D1 save fails, the enquiry still arrives by email with `[DB save failed]` at the start of the subject; that email is then the only copy.
- Retention (Privacy Policy): enquiries 2 months, booking records 1 year after the trip. Delete old enquiries with
  `... --command "DELETE FROM inquiries WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 months')"` (only after checking none became a booking).
