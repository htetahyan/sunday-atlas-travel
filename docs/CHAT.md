# Chat

Sunday Atlas Travel answers questions from its own pages. A build step writes a search index. A Cloudflare Pages Function reads that index, calls Workers AI, and returns a short reply plus link buttons. The company plans and arranges the trip itself. The assistant quotes a price only when that package's page lists one, and only as written. Anything else is on request. The inquiry form at `/{locale}/contact/` is how a visitor leaves a name and email.

Locales: `en`, `de`, `fr`, `ja`, `es`.

No chat API secret is required. Workers AI is a Pages binding, not a third-party key.

## Architecture

1. `scripts/build-chat-index.mjs` reads every `content/destinations/*.json` and `content/packages/*.json` file (it does not hard-code slugs) and the dictionary sections for FAQ items, how-it-works steps, and the contact page intro. An entry is skipped when `published !== true`, when `draft === true`, or when `seo[locale].noindex === true`. FAQ, how-it-works, and contact entries are skipped for a locale when `content/pages/faq.json`, `how-it-works.json`, or `contact.json` has `seo[locale].noindex === true`. Empty locale strings fall back to English, the same rule as the site. The script writes `public/chat-index/{locale}.json`. That directory is gitignored. `npm run build` runs the script before `next build`, so the static export copies the index into `out/chat-index/`. `npm run chat:index` rebuilds only the index.
2. `functions/api/chat.ts` is a Pages Function on `POST /api/chat`. It checks the `Origin` header, rate-limits with the `CHAT_RL` KV binding, applies a global daily cap on the same binding, loads `/chat-index/{locale}.json` from the deployment (`env.ASSETS.fetch`, then `fetch`), and keeps the top four matching pages. Scoring ignores Latin tokens shorter than three characters and common stopwords in English, German, French, and Spanish (for example `the`, `eine`, `der`, `le`, `el`, `how`, `wie`). A question such as "Gibt es eine Antarktis-Kreuzfahrt?" then matches nothing. CJK runs (Han, Hiragana, Katakana, and the long-vowel mark ー) are stored whole and as character bigrams. A run splits when the script changes, and the long-vowel mark stays inside the word, as in ツアー. カザフスタン yields カザ, ザフ, フス, スタ, and タン. A number written against the word, such as 3スタン, is kept as its own token. Those tokens are taken from the title, destination name, region, and summary. The query uses the same bigrams. Bigrams made only of the hiragana particles の, に, つ, い, て, を, は, が, で, と, も, and か are dropped. Those bigrams score against the title and the keywords.
3. The function calls Workers AI through the `AI` binding: `env.AI.run(model, { messages, max_tokens: 300, temperature: 0.2 })`. The call is limited to about 15 seconds (`Promise.race`). Reply text is `result.response`, whether that value is a string or an object. The instruction is English. The reply language is the visitor's locale, named explicitly (for example `Japanese (日本語)`), even when the question is in another language.
4. To stay inside the Workers AI free allowance, the function sends only those four pages (the allowed range is 3 to 5). Each summary is cut to 300 characters and each page keeps at most five highlights. History is the last six turns, and each turn is cut to 500 characters. `max_tokens` is 300. A visitor message longer than 500 characters is rejected with HTTP 400 and `error: "message_too_long"`.
5. Link buttons come only from the index (`{ title, url }`). Every successful response ends with the contact link after up to three matched entries, so there are at most four links. The model is told not to write URLs, and any URL it writes is not turned into a button. Bracketed context markers such as `[3]` are stripped from the reply. If nothing matched, the only link is the contact page, and the reply offers the inquiry form when the model did not. `unsafeAmounts` then checks the reply against the numbers in the serialized context. An unsafe reply is replaced with the listed price text of up to two matched packages, or with the on-request sentence when none of them has a listed price. See Prices below. A missing `AI` binding, an upstream error, or a timeout returns HTTP 200 with `error: "unavailable"` and links that include the contact page.

`OPTIONS` returns 204 for an allowed origin, with `Access-Control-Allow-Origin` set to that origin, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: content-type`, and `Vary: Origin`. Any other origin, or a missing origin, returns 403 `{ "error": "forbidden_origin" }`.

Allowed origins:

- `https://sunday-atlas-travel.pages.dev`
- `https://*.sunday-atlas-travel.pages.dev`
- `https://sundayatlastravel.com`
- `https://www.sundayatlastravel.com`
- `http://localhost:*`
- `http://127.0.0.1:*`

Request body: `{ "message": string, "locale": "en"|"de"|"fr"|"ja"|"es", "history"?: { "role": "user"|"assistant", "content": string }[] }`. `message` is trimmed and must be 1 to 500 characters. A missing locale defaults to `en`.

Rate limit, when `CHAT_RL` is bound: 20 messages per 10 minutes and 100 per day, keyed by `CF-Connecting-IP` (else the first `x-forwarded-for` value, else `unknown`). Over the limit the function returns 429 `{ reply, links: [contact], error: "rate_limited" }` with the localized reply. If `CHAT_RL` is missing, the function logs one warning and does not limit.

Global daily cap, when `CHAT_RL` is bound: `DAILY_CHAT_CAP` in `functions/api/chat.ts` is 800. After the per-IP check, and only once a model binding is available, the function reads the key `cap:{YYYY-MM-DD}` (UTC date) immediately before the model call. If the counter is already at 800, it returns HTTP 200 `{ reply, links: [contact], error: "daily_cap" }` with the localized `dailyCap` sentence and does not call the model. Otherwise it increments the counter (best effort, not atomic) with `expirationTtl` of about two days (172800 seconds) and continues. A missing `CHAT_RL` binding skips the cap. The same namespace as the per-IP limiter holds this key.

Fallback copy for all five locales lives in `functions/api/_i18n.ts`.

The system prompt tells the model: it is the assistant of Sunday Atlas Travel, which plans and arranges tour packages and tailor-made trips itself; it is an automated assistant, not a live person, and must never claim a human is chatting or will join; our team replies to inquiries by email; answer only from `CONTEXT`; reply only in the page language; never mention partners, local agencies, operators, third parties, or a middleman; never invent prices, price numbers, dates, departures, availability, or visa rules; quote a listed price only exactly as written in `CONTEXT`; do not promise response times or turnaround times unless they appear verbatim in `CONTEXT`; if the answer is not in `CONTEXT` or the model is unsure, say so and invite the visitor to `/{locale}/contact/` to leave a name and email; keep answers under 120 words; plain text, no markdown links or URLs.

## Prices

Each published package with a numeric `priceFrom` and a currency is stored with that listed price. The index entry has `price.from`, `price.currency`, the localized `fromLabel`, the localized `priceNote`, and the full per-person table: caption, group sizes, and every row's label, prices, and single supplement. Numbers are copied as stored. There is no rounding and no thousands separator. `priceText` is the from-label, a period, and the price note. A trailing "see the table below" (also "siehe Tabelle unten", "voir le tableau ci-dessous", "下の料金表をご覧ください", and "vea la tabla de abajo") is rewritten in `priceText` and `price.note` to the localized tour-page sentence, for example "see the price table on the tour page: /en/packages/five-stans-long-road-22-days/." The content files stay unchanged. Those words and the table caption are also keywords. A package without that pair keeps the localized on-request sentence in `priceText` and has no `price` object. A note that contains a digit is still dropped for those unpriced packages.

The serialized table uses the locale's own words. Each cell is the group-size label and the per-person amount in that locale's pattern (`6964 USD per person`, `6964 USD pro Person`, `1名あたり 6964 USD`, and the French and Spanish forms). The row starts with the localized price-table label, and the single supplement uses the localized name. The model may quote a figure only when it is written in the retrieved context. It writes each per-person amount exactly in the form shown in `CONTEXT`, and it uses the season, group-size, and hotel-class labels as written there, in the reply language. When the visitor names a group size and a hotel class, the model is told to read that one cell. Two people is the column whose label covers 2. 4* is the row for that hotel class. It must not compute a total, a sum for the group, a discount, a conversion, an average, or any number that is not written in the context. A request for a total gets the per-person figure and the note that the team confirms the final quote by email. If the package in the context is on request, or no package matches, the model gives no number and offers the inquiry form.

After the model replies, bracketed context markers are stripped, then `rewordTableBelow` replaces a leftover "see the table below" (including "see the table", "Tabelle unten", "ci-dessous", "下の料金表", and "tabla de abajo") with that tour-page sentence. The url is the first matched package that has a listed price. If none does, the phrase is removed. `unsafeAmounts` in `functions/api/chat.ts` then checks the text. The reply is normalized with NFKC. Every number is read with thousands separators (comma, dot, no-break space, narrow no-break space, or a plain space between groups of three digits), so "6,964", "6 964", and "6.964" are the same number. The allowed set is every number in the serialized context that was sent to the model. The reply is unsafe if it contains a number greater than or equal to 100 that is not in that set, or a currency amount whose number is not in that set. Currency may sit before or after the number: `$`, `€`, `¥`, `£`, USD, EUR, GBP, JPY, CHF, 円, or ドル. Digits in a package url such as `/packages/3-stans-discovery-14-days/` are below 100, so they are not a price. An unsafe reply is replaced. When a matched package has a listed price, the replacement lists up to two of those packages as `title: priceText` (the index text, which already names the tour page) and then the contact-form sentence. Otherwise the replacement is the on-request sentence.

Drafts (`draft === true`), unpublished entries (`published !== true`), and entries with `seo[locale].noindex === true` are left out of that locale's index. The same noindex rule drops the FAQ, how-it-works, and contact entries when that page's seo says so.

## Model

`CHAT_MODEL` in `functions/api/chat.ts` is the model every deployment runs:

```ts
export const CHAT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
```

The comment above that constant names the cheaper alternative `@cf/meta/llama-3.1-8b-instruct-fast`. To switch the live model, change `CHAT_MODEL` and deploy. Do not put a model id in the dashboard: `wrangler.toml` does not carry the model, and a dashboard variable would be the wrong place for it.

For a local comparison only, set `CHAT_MODEL_OVERRIDE` to another model id. The function uses that id only when the request URL hostname is `localhost` or `127.0.0.1`. A production hostname ignores the override.

## Model choice

The same seven questions (three Japanese, three German, and one English) were run on both models.

Mistral Small 3.1 gave fluent, grounded Japanese and German answers. Llama 3.1 8B fast gave a vague Japanese answer about the 5 Stans tour and once leaked a context marker like `[3]` into the reply. Mistral Small uses more Workers AI neurons per answer, so watch the free daily allowance.

## What the project owner sets in Cloudflare

These are Cloudflare settings, not GitHub secrets. The deploy workflow does not read a chat key. There is no secret to create.

`wrangler.toml` at the repo root is the source of truth. It names the Pages project (`sunday-atlas-travel`), sets `pages_build_output_dir = "out"` and `compatibility_date = "2024-09-23"`, and binds Workers AI:

```toml
[ai]
binding = "AI"
```

After this file is deployed, the dashboard is read-only for the same bindings and variables. A binding added only in the dashboard is overwritten on the next deploy. `npx wrangler pages deploy out` runs from the repo root and bundles `./functions` with this config. The workflow checks that `functions/api/chat.ts` and `wrangler.toml` exist before that command.

Workers AI draws on the account allowance. The free allowance is about 10,000 neurons per day. Usage past that is billed. The caps in the function (four short pages, six history turns, 300 output tokens) are there to keep a normal day of questions inside that allowance.

Rate limiting and the daily cap use the KV namespace `sunday-atlas-chat-rl` (id `2894d60df66c464d88b3614edc3a26de`, created 2026-10-18), bound as `CHAT_RL` in `wrangler.toml`. Do not add `CHAT_RL` only in the dashboard: `wrangler.toml` replaces dashboard bindings on every deploy. If the binding is ever missing, chat still answers and logs a warning that rate limiting and the cap are off.

## Local testing

No real model, and no login. From the repo root:

```sh
npm run build
npx wrangler pages dev out --kv CHAT_RL --binding CHAT_MOCK_AI=1
```

In another terminal:

```sh
node scripts/test-chat.mjs
```

`BASE` defaults to `http://127.0.0.1:8788`. The mock is `functions/api/_mock-ai.ts`. It reads `CONTEXT` titles from the system message and returns a fixed reply in the page language (`Here is what I found: <titles>.`). An empty `CONTEXT` returns the contact-form sentence. A price question whose context contains a price table returns the first `price:` line. If that question also names a hotel class such as `4*` and a group size, the mock answers with that table cell. A user message that contains `PRICE_TRAP` returns `It costs $1,999.` and one that contains `TOTAL_TRAP` returns `The total for 2 people is $13,928.`, so the amount guard can be checked. The script prints `PASS` or `FAIL` for each case and exits non-zero on failure. The last case sends 22 requests and expects a 429 while `CHAT_RL` is bound (`--kv CHAT_RL`). Set `REQUIRE_RL=0` to skip that assertion.

`wrangler pages dev` loads the `[ai]` binding from `wrangler.toml`, so `env.AI` is set even for this command. On `localhost` and `127.0.0.1`, `CHAT_MOCK_AI=1` selects the mock and does not call Workers AI. On any other hostname the flag is ignored. If `AI` is missing and the flag is not set, the function returns the localized unavailable reply.

Pass `--ai AI` only when you want the real model. That uses the account's Workers AI even on your machine, including the free allowance. Do not set `CHAT_MOCK_AI` on that run. With the `[ai]` block in `wrangler.toml`, `pages dev` already has the binding; `--ai AI` is how you attach it when that block is absent.

```sh
npx wrangler pages dev out --kv CHAT_RL --ai AI
```

To compare two models, start two dev servers that differ only by `CHAT_MODEL_OVERRIDE`. The default model is `CHAT_MODEL`. The override applies on localhost only.

```sh
npx wrangler pages dev out --port 8788 --kv CHAT_RL --ai AI
npx wrangler pages dev out --port 8790 --kv CHAT_RL --ai AI --binding CHAT_MODEL_OVERRIDE='@cf/meta/llama-3.1-8b-instruct-fast'
BASE=http://127.0.0.1:8788 node scripts/compare-models.mjs
BASE=http://127.0.0.1:8790 node scripts/compare-models.mjs
```

`scripts/compare-models.mjs` posts the same seven questions (three Japanese, three German, one English: the 3 Stans and Kazakhstan, a 5 Stans price with group size and hotel class, a 4 Stans price, a destination the index does not have, and how a trip is arranged) to `BASE/api/chat` with `Origin: http://localhost:8788`, and prints locale, question, reply, and links.
