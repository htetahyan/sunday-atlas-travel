-- Run after /api/inquiry is live. The browser no longer inserts directly, so
-- anon loses table INSERT. Rows arrive only through public.submit_inquiry,
-- which checks the server-only token.
drop policy if exists "anon can insert inquiries" on public.inquiries;
revoke insert on table public.inquiries from anon;
