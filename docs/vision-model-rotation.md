# Vision model rotation

Default order: `nvidia/nemotron-3.5-super-vl-120b-a12b`, then
`meta/llama-3.2-90b-vision-instruct`. Existing `BLOG_NVIDIA_VISION_MODEL`
selects a single model as before (and disables default rotation).

An operator can explicitly override the ordered list with:

```
BLOG_NVIDIA_VISION_MODELS=nvidia/nemotron-3.5-super-vl-120b-a12b,meta/llama-3.2-90b-vision-instruct
```

The ordered comma list takes precedence over the legacy singular variable;
whitespace and duplicate entries are removed. A per-call `{ model }` explicitly
pins one model. Four HTTP attempts total per image, at most two per model.
Only HTTP 429, HTTP 500–599 and actual timeout exceptions retry/rotate.
Backoff is 2 seconds before the same-model retry and 4 before rotation, or the
full Retry-After if larger. Total retry sleep budget is 120 seconds: a larger
server delay fails closed rather than being shortened. Existing concurrency and
request spacing remain shared with writing/translation; server cooldown is
shared too. Already in-flight requests cannot be recalled. Limiter queue time
and server cooldown for other calls are separate from this retry sleep budget.

No native structured-output API is requested: existing prompt JSON and strict
photo-gate parsing/criteria are unchanged. Any successful HTTP reply returns
immediately to that gate, including a rejection, malformed or uncertain reply;
these NEVER trigger another model. Authentication, unsupported-model errors,
other network errors and exhausted attempts fail closed.

NVIDIA's current catalog documents text/image input and text output for Meta's
model, but no native structured-output support:
https://build.nvidia.com/meta/llama-3.2-90b-vision-instruct
https://build.nvidia.com/llms.txt

Only Nemotron models receive `chat_template_kwargs.enable_thinking=false`.
Meta uses the ordinary OpenAI-compatible image_url message. Live controls passed
on November 7, 2026, 16:54 Asia/Dubai using the unchanged production gate:
clean-landscape accepted; text-overlay rejected with has_text=true;
logo-corner rejected with has_logo=true. All three produced parseable schema
booleans. See vision-live-validation-2026-11-07.md. This is a smoke test, not a
comprehensive accuracy benchmark. No production configuration has been changed;
the default order takes effect only after this feature is merged into the
runtime's source branch. No deployment is required for subsequent Actions runs
that check out that source branch; separately running consumers need the code.
Model switching is not a guarantee against an account-wide rate limit.

Offline verification:

```
node --test scripts/test-vision-rotation.mjs
node scripts/test-image-finder.mjs
```
