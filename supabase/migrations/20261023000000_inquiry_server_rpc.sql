-- Server-side inquiry path for POST /api/inquiry (Pages Function).
-- The function calls two SECURITY DEFINER RPCs with the public anon key plus a
-- server-only token (Pages secret INQUIRY_DB_TOKEN). Only the SHA-256 of that
-- token is stored here, in private.app_secrets. No key or token in this file.
-- Set the hash once in the SQL editor (never commit it):
--   insert into private.app_secrets (name, sha256)
--   values ('inquiry_db_token', decode('<hex sha256 of the token>', 'hex'))
--   on conflict (name) do update set sha256 = excluded.sha256;

alter table public.inquiries
  add column if not exists email_status text not null default 'pending',
  add column if not exists email_error text,
  add column if not exists email_sent_at timestamptz;

alter table public.inquiries drop constraint if exists inquiries_email_status;
alter table public.inquiries
  add constraint inquiries_email_status check (email_status in ('pending', 'sent', 'failed'));

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_secrets (
  name text primary key,
  sha256 bytea not null
);
revoke all on table private.app_secrets from public, anon, authenticated;

create or replace function private.inquiry_token_ok(token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.sha256 = pg_catalog.sha256(pg_catalog.convert_to(coalesce(token, ''), 'UTF8'))
       from private.app_secrets s
      where s.name = 'inquiry_db_token'),
    false
  );
$$;
revoke all on function private.inquiry_token_ok(text) from public, anon, authenticated;

create or replace function public.submit_inquiry(token text, payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not private.inquiry_token_ok(token) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.inquiries (
    name, email, passport_country, destination, travel_dates, group_size,
    message, package_slug, locale, consent, email_status
  ) values (
    payload->>'name',
    payload->>'email',
    payload->>'passport_country',
    payload->>'destination',
    payload->>'travel_dates',
    payload->>'group_size',
    payload->>'message',
    nullif(payload->>'package_slug', ''),
    payload->>'locale',
    coalesce((payload->>'consent')::boolean, false),
    'pending'
  )
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.mark_inquiry_email(token text, inquiry_id uuid, status text, error text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.inquiry_token_ok(token) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if status not in ('sent', 'failed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.inquiries
     set email_status = status,
         email_error = case when status = 'failed' then left(coalesce(error, ''), 500) else null end,
         email_sent_at = case when status = 'sent' then now() else null end
   where id = inquiry_id and email_status = 'pending';
end;
$$;

revoke all on function public.submit_inquiry(text, jsonb) from public, anon, authenticated;
revoke all on function public.mark_inquiry_email(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_inquiry(text, jsonb) to anon;
grant execute on function public.mark_inquiry_email(text, uuid, text, text) to anon;
