# rare-atlas-cms-auth

Free Cloudflare Worker that does the GitHub OAuth handshake for Decap CMS.
Deployed at https://rare-atlas-cms-auth.htetahyan.workers.dev (`npx wrangler deploy` from this folder).

Routes: `/auth` (redirects to GitHub) and `/callback` (GitHub OAuth App callback URL).

Secrets (set with `npx wrangler secret put`, never commit): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
`ALLOWED_ORIGINS` in wrangler.toml lists the site origins allowed to receive the token; add the production domain when it exists.
