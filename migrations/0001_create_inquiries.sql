-- D1 (SQLite) table for trip enquiries from POST /api/inquiry.
-- Same columns as the old Supabase public.inquiries (supabase/migrations), adapted:
-- uuid -> TEXT (crypto.randomUUID()), timestamptz -> TEXT ISO 8601 UTC, boolean -> INTEGER 0/1.
-- Apply: npx wrangler d1 migrations apply sunday-atlas-inquiries --remote
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  email TEXT NOT NULL CHECK (length(email) <= 200 AND email LIKE '%_@_%._%'),
  passport_country TEXT NOT NULL CHECK (length(passport_country) BETWEEN 2 AND 80),
  destination TEXT NOT NULL CHECK (length(destination) BETWEEN 1 AND 80),
  travel_dates TEXT NOT NULL CHECK (length(travel_dates) BETWEEN 2 AND 120),
  group_size TEXT NOT NULL CHECK (length(group_size) BETWEEN 1 AND 40),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 10 AND 4000),
  package_slug TEXT,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'de', 'fr', 'ja', 'es')),
  consent INTEGER NOT NULL CHECK (consent = 1),
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  email_error TEXT,
  email_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS inquiries_created_at ON inquiries (created_at DESC);
