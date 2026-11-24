# Blog recovery — November 8, 2026

## Fresh evidence and cause

PR70 was still open/unmerged. Latest generator failure:
https://github.com/htetahyan/rare-atlas-travel/actions/runs/42439792767
(started November 8, 06:44 Asia/Dubai). It made **zero AI calls**, found 35
unused Turkmenistan bank terms but zero usable non-duplicate topics, and stopped.
The cycle had only one unvisited destination, so resetting only when the raw
order was empty could strand other viable destinations indefinitely. Both
async execution and sync planning now try viable next-pass destinations only
AFTER exhausting the current pass; explicit daily blocks, duplicate/used-keyword
filters and same-day destination exclusions remain intact. No stored keywords
or existing posts were deleted or reset. The real stored-keyword preview now
selects Poland and three unused bank topics instead of stopping at Turkmenistan.

Latest deployment failure:
https://github.com/htetahyan/rare-atlas-travel/actions/runs/42455465145
(started November 8, 10:36 Asia/Dubai). Compilation completed, then sitemap,
llms-full, error pages and several otherwise trivial routes exceeded static
worker timeouts. Isolated local measurement identified synchronous sitemap
work: **112,431 ms and 205,131 content reads**, while llms-full alone took 255 ms.
Repeated URL × locale × alternate lookups reparsed/normalized whole catalogs.
This synchronous work can starve other routes sharing that worker; the llms/error
route names alone were misleading. No timeout setting was raised.

Normalized catalogs are now snapshotted once per production worker, returning
separate arrays; development bypasses the cache. Same-corpus measurements after
fix: sitemap **66 ms**, 517 cumulative reads including llms-full/import work;
llms-full 149 ms. Full controlled `next build` completed all **607 static pages**
and export in **21.2 seconds**. This bypassed CMS sync and publishing; it is not
proof that the entire production deploy workflow has run successfully.

## Prepared behavior (not active until merged)

- PR70's previously live-validated vision rotation is included unchanged in this
  combined PR, apart from slower shared request defaults: concurrency 2 and at
  least 3 seconds between NVIDIA starts (~20/min across writing/translation/vision).
  This does not promise immunity to account-wide limits.
- One scheduled run at 06:17 Asia/Dubai, plus existing hourly catch-up of that same run after 02:17 UTC. Aggregate
  ceiling is **1 stored/generated post per actual Asia/Dubai day**, counted from
  creation timestamps across all posts, not the requested historical slot/date.
  Manual production runs cannot bypass it. Missed earlier days stay missed. Partial runs
  can top up only the remaining allowance. Preview/dry-run do not persist posts.
  Workflow concurrency serializes jobs. Existing slot history remains compatible.
- A normal completed generation report says `generated-only`, deployed=false,
  liveVerified=false. CMS/content `published` flags remain eligibility/duplicate
  bookkeeping, not proof of public delivery. Generation summary never calls its
  count verified published.
- Build steps synchronize CMS once, then try the same Next export at most twice;
  uploader tries the same stamped `out/` at most twice (15 seconds apart). Neither
  retry calls the blog generator. Compressed export artifact is retained for one day to bound existing Actions storage.
- Each actual exported blog locale page receives a build-SHA/content-hash marker.
  After uploader success, main deployments GET all those public pages and demand
  HTTP success plus the expected marker. A post counts published only if **every
  exported locale page** for it verifies. Soft/stale pages fail closed. Requests
  have 8-second timeouts, at most two attempts/page and a 3-minute overall budget;
  verification stops further requests on 429. A delayed CDN can therefore produce
  a conservative unverified result, never a false publication count.
- Verification report artifact and deployment step summary separately state
  exported/generated count and verified-published count. Preview deployments do
  not claim live production verification. No new database/service/secret needed.

## Recovery / release handoff

The combined PR contains PR70, so review/merge ONLY the new combined PR into main,
then close PR70 as superseded; do not cherry-pick or merge both independently.
Executor did not merge, deploy, generate posts, change secrets or resume routines.
Existing main behavior is still active until an owner/parent merges.

Merging main triggers the normal existing deployment pipeline. Its next normal
blog run uses the new pacing/rotation/cap. To recover an already generated post,
retry the **deployment job**, never the daily generator. Within a job upload retry
uses identical export bytes. For a later failed job, the pinned source plus
retained `site-export-*` artifact provides an exact export for authorized replay;
functions and wrangler config must come from the same checked-out SHA. Artifact
replay is not an automatic unbounded workflow redispatch loop.

If verification alone failed due to propagation, rerun the verifier against the
retained manifest after the site settles, with authorization, rather than writing
another post. CI may rebuild on a manual job rerun, but this does not regenerate
blog posts. Production CMS inputs/platform/credentials may differ from this local
build; the first real deployment and its live report still need watching.

## Verification performed before feature release

- `node --test scripts/test-vision-rotation.mjs scripts/test-blog-daily-budget.mjs scripts/test-blog-publication.mjs`: 25 passed, 0 failed.
- Existing image finder: 150 checks passed; existing translation/limiter: 85 checks passed.
- Title/slot/destination-failover/one-batch preview suite passed, including witnessed failing regressions before fixes.
- Production content snapshot/sitemap regression passed (107 initial catalog reads; development refresh preserved).
- `npm run typecheck`: app and Functions passed.
- Controlled `next build`: 607 static pages exported; no CMS pull or publishing invoked.
- `npm run postbuild`: 608 HTML files checked, no placeholders; zero supplier leaks across 1,275 files.
- Workflow YAML and all embedded bash syntax parsed; `git diff --check` passed.
- No live-site marker verification claimed: the prepared markers have not been deployed.

## Follow-up — one post per day (11 November 2026)

Automatic generation is now exactly one post per Asia/Dubai day (replacing the
temporary 3/day cap). There is a single scheduled slot at 02:17 UTC / 06:17
Asia/Dubai. Hourly catch-up may retry that same slot after it has started;
previous days are not filled as a backlog. Reliability pieces from PR #71
(vision rotation, NVIDIA pacing, sitemap catalog snapshots, bounded deploy
retry and live publication verification) are unchanged.
