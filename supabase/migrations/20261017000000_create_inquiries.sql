-- Contact-form inquiries. Run in the Supabase SQL editor.
-- anon may INSERT only. No select, update, or delete policy.
-- Do not put API keys in this file.

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  email text not null,
  passport_country text not null,
  destination text not null,
  travel_dates text not null,
  group_size text not null,
  message text not null,
  package_slug text,
  locale text not null,
  consent boolean not null,
  constraint inquiries_name_length check (char_length(name) between 2 and 120),
  constraint inquiries_email_length check (char_length(email) <= 200),
  constraint inquiries_email_format check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint inquiries_passport_length check (char_length(passport_country) between 2 and 80),
  constraint inquiries_destination_length check (char_length(destination) between 1 and 80),
  constraint inquiries_travel_dates_length check (char_length(travel_dates) between 2 and 120),
  constraint inquiries_group_size_length check (char_length(group_size) between 1 and 40),
  constraint inquiries_message_length check (char_length(message) between 10 and 4000),
  constraint inquiries_consent_true check (consent = true),
  constraint inquiries_locale check (locale in ('en', 'de', 'fr', 'ja', 'es'))
);

alter table public.inquiries enable row level security;

revoke all on table public.inquiries from anon, authenticated;

grant insert on table public.inquiries to anon;

create policy "anon can insert inquiries"
  on public.inquiries
  for insert
  to anon
  with check (consent = true);
