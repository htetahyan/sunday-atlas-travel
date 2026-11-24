# Automatic machine translation

Sunday Atlas Travel stores English and four other languages in the same JSON file. This pipeline fills **empty** and **stale** German, French, Japanese, and Spanish copy. It does not replace a translation a person has written.

Locales: `en`, `de`, `fr`, `ja`, `es`. Targets: `de`, `fr`, `ja`, `es`.

Simplified Chinese (`zh`) is not a target here. It is a partial locale filled one item at a time by the zh-translate workflow; see `docs/ZH.md`. This pipeline leaves `zh` values untouched.

## What gets translated

The scanner reads `content/packages/*.json`, `content/destinations/*.json`, and `content/pages/*.json`. It does not read `content/settings/`.

A **localized field** is any object, at any depth, whose keys are a subset of `en`, `de`, `fr`, `ja`, `es` and whose `en` value is a string or an array of strings. That covers titles, summaries, intros, itinerary day titles, descriptions, and meals, included and not-included lists, FAQ questions and answers, image alt text, headings, price notes, price-table captions, group sizes, row labels, hotels, vehicles, and page sections.

`seo` is different. Each locale is an object:

```json
{
  "seo_title": "",
  "meta_description": "",
  "focus_keyword": "",
  "keywords": [],
  "og_image": "",
  "canonical": "",
  "noindex": false
}
```

The pipeline translates `seo_title` and `meta_description`. It **generates** `focus_keyword` and `keywords` as native search phrases in that language. It never changes `og_image`, `canonical`, or `noindex`.

Slugs, image `src`, prices, `durationDays`, and other numbers are not localized and are never modified.

Files stay 2-space JSON with a trailing newline (`JSON.stringify(doc, null, 2) + "\\n"`). Unicode is not escaped. A file is rewritten only when a translation was applied.

## Missing, stale, human, current

For each field and each target locale:

| Status | Meaning | Action |
| --- | --- | --- |
| skip | English is empty | Leave the field alone |
| missing | Target is missing, `""`, `[]`, or only whitespace | Translate |
| human | Target is non-empty and there is no sidecar hash for that locale, or the text no longer matches the hash we stored | Skip and log the path |
| stale | Target still matches the hash we stored, but English has changed | Translate again |
| current | Target matches the stored hash and English is unchanged | Leave it |

For SEO keywords the English value hashed is `{ focus_keyword, keywords, seo_title }`. The target value hashed is `{ focus_keyword, keywords }`. For `seo_title` and `meta_description` the value is the string.

Hashes are SHA-256 of canonical JSON (object keys sorted, no extra whitespace).

## Sidecar

Translations remember what they wrote in a sidecar next to the content tree:

`content/.translations/<same path as the file under content/>`

Example: `content/.translations/packages/3-stans-discovery-14-days.json`.

```json
{
  "version": 1,
  "fields": {
    "itinerary[1].description": {
      "src": "<sha256 of the English value>",
      "de": "<sha256 of the machine translation we wrote>"
    },
    "seo.seo_title": { "src": "...", "de": "..." },
    "seo.keywords": { "src": "...", "de": "..." }
  }
}
```

Field paths use dots and `[i]` (`itinerary[1].description`, `priceTable.rows[0].label`).

Decap reads `content/packages`, `content/destinations`, and individual files under `content/pages`. `src/lib/content.ts` reads those same folders one level deep. Neither reads `content/.translations`, so a Decap save cannot drop the sidecar.

## Validation and retry

Before a translation is written, `validateTranslation` in `scripts/lib/auto-translate-core.mjs` checks it:

- The result is non-empty. Japanese must contain Han, Hiragana, or Katakana.
- The multiset of numbers matches after NFKC, ignoring thousands and decimal separators between digits (`6,964` and `6964` match, `10.5` and `10,5` match).
- `http` and `https` URLs match, including `res.cloudinary.com`. Site paths such as `/en/packages/...` match as a set. The locale segment may stay `en` or become the target locale.
- Currency symbols and codes present in English (`$`, `€`, `£`, `¥`, `USD`, `EUR`, `GBP`, `JPY`) must appear in the result.
- Placeholders match: `{x}`, `{{x}}`, `%s`, and HTML tags.
- Markdown structure matches: heading lines, list lines (`-`, `*`, `1.`), links, and `**` markers.
- Brand rule: the result must not match reseller or intermediary wording (`partner`, `agency`, `Agentur`, `opérateur`, `代理店`, and the rest of the pattern in the core module). If the English source contains the same kind of wording, the result is **still rejected** and the log says a person must fix the English.

Arrays must be the same length and are checked element by element. Keyword lists must be 5–15 non-empty strings, with no duplicates. Japanese keywords must contain CJK. They are native queries, not a copy of the English list.

On failure the failed items are sent once more. If they still fail, the field is left as it was (an empty field stays empty). Nothing is written and no hash is stored. The log has the path and the reasons. The process still exits 0.

## The Pages Function and the secret

`functions/api/translate.ts` is `POST /api/translate`. It uses the Workers AI binding `AI` from `wrangler.toml`.

- Header `x-translate-secret` is compared with the Pages secret `TRANSLATE_SECRET` in constant time (SHA-256 both values, then XOR the digests). Wrong or missing header: `401 { "error": "unauthorized" }`.
- Secret unset: `503 { "error": "not_configured" }`.
- Other methods: `405`. There are no CORS headers. This route is server to server.
- The secret is never logged. Request bodies are never logged.

GitHub Actions reads the repository secret `TRANSLATE_SECRET`. Cloudflare Pages reads its own production secret `TRANSLATE_SECRET`. They are the same value, stored in two places. `wrangler.toml` has no `[vars]` section. A deploy updates bindings from that file and does not overwrite Pages secrets that are not declared there.

The model constant is `TRANSLATE_MODEL` (`@cf/mistralai/mistral-small-3.1-24b-instruct`). This is a placeholder until a side-by-side comparison is recorded here. `body.model` is honored only when the request hostname is `localhost` or `127.0.0.1`.

`TRANSLATE_MOCK_AI=1` on loopback returns a deterministic stand-in for tests: `「de」 ` plus the source text, or eight keyword strings (`日本 キーワード n` for Japanese).

## Neurons and caps

The CLI estimates neurons from token usage returned by the function. If usage is missing, tokens are `chars / 4`.

| Model | Input neurons / 1M tokens | Output neurons / 1M tokens |
| --- | --- | --- |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 31876 | 50488 |
| `@cf/meta/llama-3.1-8b-instruct-fast` | 4119 | 34868 |
| `@cf/meta/m2m100-1.2b` | 31050 per 1M tokens, input and output combined | |

Defaults: 40 calls (`MT_MAX_CALLS`) and 8000 neurons (`MT_MAX_NEURONS`). `--max-calls` and `--max-neurons` override them. The run stops before a call that would pass a cap and logs what is left for the next run.

Batches are per file and per locale, at most 30 items and 9000 English characters. A longer field is sent alone.

## Workflow

`.github/workflows/deploy-pages.yml`:

1. **translate** (contents: write). Skipped entirely when the head commit message contains `[auto-translate]` or the actor is `github-actions[bot]`. Deploy still runs. On push, it looks at `git diff` for `content/`. `workflow_dispatch` always translates. An empty `TRANSLATE_SECRET` warns and sets `pending=false`. Otherwise it runs `node scripts/auto-translate.mjs`. If files changed, it commits `content/packages`, `content/destinations`, `content/pages`, and `content/.translations` as `github-actions[bot]` with message `chore(content): machine translations [auto-translate]`, then `git pull --rebase origin main` and `git push origin HEAD:main` (one retry, never force).
2. **deploy** runs even if translate failed or was skipped (`always()` and not cancelled). It checks out the translate job's sha, or the original sha if that output is empty. The existing build, indexability guard, function guard, and `wrangler pages deploy` steps are unchanged. `--commit-hash` is that sha. When the deployed commit subject contains `[auto-translate]`, that tag is appended to the Pages commit message.
3. **translate-after-deploy** runs only when translate reported `pending=true` (the function returned 404/405, `503 not_configured`, or the network failed) and deploy succeeded. It waits 30 seconds, runs the script against production, and if it pushed a commit, starts one fresh run with `gh workflow run deploy-pages.yml --ref main`. Token pushes do not trigger the push workflow. `workflow_dispatch` is the exception. The bot actor makes the second run skip translation and only deploy. That is the only case with two deploys.

Concurrency stays `pages-deploy-main` with `cancel-in-progress: false`. Workflow permissions are `contents: read`. Jobs raise their own permissions.

## Local use

```bash
node scripts/auto-translate.mjs --dry-run
node scripts/auto-translate.mjs --mock
node scripts/auto-translate.mjs --file content/packages/example.json
npm run test:translate
```

`--dry-run` prints missing, stale, human, and current counts, the planned calls, and the neuron estimate. It does not call the network and does not need `TRANSLATE_SECRET`.

`--mock` uses the same stand-in as the Pages Function. Japanese mock sentences do not contain CJK, so validation rejects them and the field stays empty. Use it for tests, not for real copy.

A real run needs `TRANSLATE_SECRET` and uses `TRANSLATE_URL` (default `https://sundayatlastravel.com/api/translate`).

## How a person takes a field back

Edit the locale string in Decap and publish. The text no longer matches the sidecar hash, so the next run marks it **human** and will not overwrite it.

To force a new machine translation, clear that locale (empty string or empty list) and publish. The next run sees **missing** and translates it. Deleting the sidecar while leaving the text in place does the opposite: the field becomes human and is protected.

## Model choice and cost

Compared on real Workers AI (Charyn–Kolsai–Kaindy, ja and de):

| Model | Result |
| --- | --- |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | **Chosen.** Natural ja/de, correct place names, native keywords, valid JSON. About 20 tokens/s. |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Broken JSON in ja. |
| `@cf/meta/llama-3.1-8b-instruct` | Invented place names (e.g. カラカラ湖 for Kolsai). |

All three are on the Workers AI free allocation (10,000 neurons/day). There is no paid plan.
The dry-run estimate for the three Almaty trips × 4 locales was 40 calls and about 1,990 neurons (about 650 per trip). The real run used about **1,300 neurons per trip** (Charyn–Kolsai–Kaindy about 1,375, Turgen–Assy about 1,330, Bogdanovich about 1,310; about 4,000 for all three, including retries), because real outputs are longer than estimated and ja needed retries. Budget about 1,300 neurons per new trip in 4 locales. Each run logs the actual neurons, using the published rates (31,876 per 1M input tokens and 50,488 per 1M output tokens).

## Throughput

Mistral Small is slow, so batches are kept small (`MT_BATCH_CHARS`, default 3500) and run through a pool of `MT_CONCURRENCY` workers (default 6) across all locales of a file. The translate jobs time out after 45 minutes. Caps: `MT_MAX_CALLS` (150) and `MT_MAX_NEURONS` (8000).

## Hosts

The workflow calls `${vars.TRANSLATE_BASE_URL || https://sundayatlastravel.com}/api/translate`. The apex is canonical. www and pages.dev answer with 301 to the apex, and a 301 turns a POST into a GET, so always call the apex directly. To point the workflow elsewhere (for example a preview deployment), set the repository variable `TRANSLATE_BASE_URL`.

## Brand post-check

Self-descriptions of Sunday Atlas as a travel agency (Reisebüro, agence de voyages, agencia de viajes) pass. Only wording about another company fails validation: partner, local operator, third party, middleman, reseller or supplier, plus the de/fr/es/ja equivalents. The chat applies the same rule, but it removes only the offending sentence.

## Style rules (prompt and validator)

- People are referred to with neutral plural nouns (de "Reisende", "Gäste", "Alleinreisende"). Gender-star, colon, underscore and middle-dot forms (`Reisende*r`, `eine*n`, `Guide:innen`, `Gäste_innen`, `voyageur·euse`) are banned in the prompt. In de and fr the validator rejects them ("gender-star form"), so the field is retried once and then left empty.
- One form per place name within an entry (de "Charyn-Canyon", ja "トゥルゲン", "アッシ高原").
- Species are translated precisely: spruce = Fichte / トウヒ, fir = Tanne / モミ, pine = Kiefer / マツ, ash = Esche / トネリコ.
- Batches are separate model calls, so place-name consistency across batches depends on the prompt rule. Check new trips once and hand-edit if needed. Hand edits differ from the MT hash, so later runs skip them as human-owned (see the Almaty test in `scripts/test-auto-translate.mjs`).
