# Decisions

Product and technical decisions for the BTC up/down guessing game. Domain terms follow [GLOSSARY.md](GLOSSARY.md).

## 1. The server owns prices and timestamps

The client only sends `up` or `down`. The server fetches all prices, sets all timestamps and resolves guesses, so nothing that decides the outcome can be manipulated, and display and resolution use one source.

## 2. Entry price = last trade before the guess arrived

The server stores `direction` and its own `createdAt`. The entry price is the last Kraken trade at or before `createdAt`, from trade history, not from the display cache. The guess request retries for up to 1 s; otherwise the guess is *locking* and resolve finds the price later.

**Why:** using the displayed price lets a player wait and lock in a stale price; using the cached price gives bots reading Kraken's live feed an edge. A note next to the buttons says that the server's receipt time counts.

## 3. Price source: Kraken BTC/USD

Public REST API, pair `XBTUSD`, no key: `Trades?count=1` for display, `Trades?since=` for entry and resolution. Kraken is the only checked source with real BTC/USD, trade history from any point in time, and terms that allow a non-commercial demo (Coinbase, Gemini and Binance forbid public display; Bitstamp and CoinGecko are too coarse). Rate limit is about 1 call/s per IP.

All Kraken specifics live in one module exposing `latestTrade()` and `tradesSince(time)`. No provider abstraction: there is no second provider.

## 4. Entry and resolution from trade history, triggered by the client

`POST /api/me/guess/resolve` advances the active guess as far as the data allows:

1. *Locking*: set the entry price (market price at `createdAt`).
2. After `createdAt + 60 s`: compare the market price at the window end with the entry price. Higher → `up` wins, lower → `down` wins, ±1. Equal → *waiting* until the first trade with a different price. No draws.
3. Data not complete yet or Kraken unavailable: retry on the next call.

Timestamps are compared at full precision. A moment's price is final once a trade *after* it is visible (trades are published in order). The result is the same as if the server had watched all along, so returning later gives no advantage and outages only delay results.

**Revisit when:** scores must update without the player online. Then add EventBridge Scheduler as a second trigger.

## 5. Serverless on AWS

CloudFront serves the React build from private S3 and `/api/*` from API Gateway (HTTP API) → one Lambda (Node.js, Hono). DynamoDB on-demand, `eu-central-1`, default CloudFront domain. One origin, so no CORS. Hono also runs as a plain local server, so no emulator is needed. Rejected: NestJS + Postgres in a container, too much operational overhead for four endpoints.

## 6. One service

One Lambda, one table, one bounded context (a player and their guesses).

## 7. Concurrency via DynamoDB conditional writes

- Place a guess only if none is active; a new player is created in the same write.
- Set the entry price only if the guess ID matches and no price is set.
- Resolve atomically (remove guess, ±1, append history) only if the guess ID still matches.

Exactly one parallel write wins; the other re-reads the state. No locks.

## 8. CloudFront caches only the display price

`GET /api/price`: `max-age=1`, Origin Shield, empty cache key, `stale-if-error`. Everything else: caching disabled, `no-store`. About one request per second reaches Kraken regardless of player count, and no player can ever see another's state. Freshness is judged by `observedAt`. No in-Lambda or DynamoDB price cache.

## 9. Anonymous player ID in a header

A player is created with their first guess, not on the first visit. The server returns a random UUID; the client stores it in `localStorage` and sends it as `X-Player-Id`. Never in URLs, never logged in full. Tabs sync via the `storage` event.

Trade-offs: no cross-device play; anyone with the ID can play as that player (122 random bits, never shown). **Revisit when** accounts or public IDs are needed (Cognito, or public ID + secret token).

## 10. Player data and retention

One item per player: `playerId`, `score` (can go negative), `activeGuess`, `history` (last 10 resolved guesses with entry price, deciding price and time, outcome), `expiresAt` (TTL one year after the last write). No personal data; the stored ID is strictly necessary, so no consent banner (§25(2) TDDDG).

## 11. API

| Method and path | Purpose | Errors |
| --- | --- | --- |
| `GET /api/price` | `{ price, tradeTime, observedAt }`, cached 1 s | `503` |
| `GET /api/me` | Player state. Never writes, never calls Kraken | `404` |
| `POST /api/me/guess` | `{ direction, seenPriceTime }`, creates the player without header | `400`, `404`, `409`, `422 PRICE_OUTDATED` |
| `POST /api/me/guess/resolve` | Advance the active guess (#4) | `404` |

All player endpoints return the same state (Appendix A), including the guess window and max delay so the frontend hard-codes neither. Every response has `serverTime`. Errors are `{ error: { code } }`; the frontend translates them. On `404` the client drops the stored ID and starts over at 0. Types are shared from the API package. No OpenAPI spec for four endpoints.

## 12. Polling and idle

- Price every 2 s while the tab is visible (Page Visibility API); *Delayed* when `observedAt` is older than 5 s server time, which disables guessing.
- After 5 min without interaction and without an active guess, polling pauses until the player clicks "Resume".
- The countdown runs locally against the server clock offset; at `resolvableAt` the client calls resolve, then every 2 s while needed.

## 13. Cost limits

API Gateway throttling (~50 req/s), the account's Lambda concurrency quota of 10, and an AWS Budgets alarm. Requests are the cost driver; pausing (#12) is the main lever. Throttling is global, so one attacker can slow the game but not raise the bill.

## 14. Security

| Threat | Protection |
| --- | --- |
| Manipulated prices, times, input | Server owns them (#1, #2); `zod` validation, strict schemas, 1 kB body limit |
| Bypassing CloudFront | Secret origin header from Terraform, checked in the Lambda |
| Cache leaks or poisoning | Only `/api/price` cached, empty cache key (#8) |
| Leaked player IDs | Header only, never logged in full (#9) |
| XSS, clickjacking | React escaping, no `dangerouslySetInnerHTML`, strict CSP (`'self'` only), `frame-ancestors 'none'` |
| CORS, CSRF | One origin, no CORS headers, no cookies, JSON-only `POST` |
| Untrusted Kraken data | Validated with `zod`; invalid data is treated as an outage |
| Information leakage | Error codes only, no stack traces |
| Transport | HTTPS only, HSTS, `nosniff`, `no-referrer` |
| Supply chain, pipeline | Lockfile, `npm ci`, Dependabot, public npm registry; GitHub OIDC limited to `main`, Actions pinned to SHAs |
| Secrets | None in code; the origin secret lives in encrypted Terraform state |

No AWS WAF (~$6–8/month). **Revisit when** there are real users or attacks.

## 15. Terraform

All infrastructure in Terraform, state in S3 with native locking. A bootstrap config creates the state bucket and the OIDC deploy role. Lambda bundled with esbuild. Alternative: AWS CDK.

## 16. GitHub Actions

Every push and PR: Biome, type check, unit, API and end-to-end tests, `terraform fmt`/`validate`. On `main`: `terraform apply`, upload the frontend, invalidate CloudFront, then a read-only smoke test against the live URL. One environment.

## 17. Frontend: React, Vite, Tailwind

One screen: score, large live price with a Live/Delayed/Paused indicator, Up and Down buttons, one status area for all feedback (locking, countdown, waiting, result, errors), the last 10 guesses, and a footer with attribution, storage note, language and theme switch (Auto/Light/Dark, applied before render).

React, the tool I know best. Rejected: shadcn/ui (more code to review than it saves), Svelte/Solid (unfamiliar). No price chart.

## 18. Testing

- **Unit** (Vitest): game rules and the Kraken adapter, including the edge cases from #4.
- **API** (Vitest) against DynamoDB Local with a fake price module, so the real conditional expressions run.
- **End-to-end** (Playwright) against the full local stack with a Kraken stub: first visit, guess, reload, win and loss, late guess, idle pause, price outage, language and theme. Playwright because one test can drive two tabs of the same player (#7).
- **Smoke test** after every deployment.

`GUESS_WINDOW_MS` and `MAX_GUESS_DELAY_MS` default to 60 s and 5 s; end-to-end tests set both to 3 s.

## 19. Repository and tooling

npm workspaces (`web/`, `api/`, `infra/`), TypeScript, Biome, Node 24. `npm run dev` starts DynamoDB Local, the API (`tsx --watch`) and Vite. Frontend data fetching with TanStack Query over a small `fetch` wrapper; Zod; AWS SDK v3. Not used: Axios, state libraries, a router, date libraries, component libraries, Powertools. Structured JSON logs. MIT licence.

## 20. Scope

**Required:** score and price always visible, up/down guess, one at a time, resolve after ≥ 60 s with a changed price, ±1, start at 0, fair third-party prices, score persisted in AWS, deployed app, README, public repo.

**Added:** return after closing the browser (#9), countdown, entry price, waiting state, last result, history (#10), English and German (#21).

**Out:** leaderboard, accounts, push, WAF, cancelling a guess (would let players dodge losses), player names.

**Operation:** personal AWS account, `eu-central-1`, every resource tagged `project=btc-up-down`, removed with `terraform destroy` afterwards.

## 21. English and German

Initial language from the browser, switch in the footer. The backend returns only codes; two typed dictionaries in the frontend, no i18n library. Numbers and times via `Intl`.

## 22. Slow or lost guess requests

The guess carries `seenPriceTime` (the `observedAt` the player saw). More than 5 s later → `422 PRICE_OUTDATED`. The client aborts after 5 s and reloads the state, so no guess exists that the player doesn't know about. The value only decides acceptance, never the entry price.

## 23. Accessibility

Semantic HTML, `aria-live="polite"` status area for key moments only, disabled buttons explain why, full keyboard use, reduced motion respected, direction never shown by colour alone, WCAG AA contrast, `@axe-core/playwright` in both themes.

## 24. Visual design

Plain and neutral: the price is the hero, the score second, the controls third. White / near-black surfaces, Tailwind `neutral` greys, colour only for up (green), down (red) and focus (blue), via semantic CSS variables. System font for text; Archivo (OFL, subset to digits, 12 kB) for price and score. Lucide icons.

Avoided: eyebrows, gradients, indigo/purple accents, glass, card stacks, hero-metric templates, coloured side borders, hard or glowing shadows, emoji icons, monospace as costume, marketing copy. One deliberate animation: the result reveal.

## 25. Implementation details

- **Kraken:** `since` accepts seconds or nanoseconds; the cursor repeats the last trade, so duplicates are dropped; 1,000 trades per page.
- **Trade search** starts 10 s before the moment, then 60 s, then 1 h; at most 5 pages per request (#3).
- **Waiting** is stored as a flag on the active guess, so `GET /api/me` reports it.
- **Malformed stored ID:** `400`, handled like `404`.
- **Local CSP:** applied by `vite preview`, so end-to-end tests run under it.
- **Origin secret:** `X-Origin-Secret`, constant-time check in `api/src/lambda.ts`.
- **Long locking:** the status text changes after 8, 16 and 24 s, and explains when the window has ended without an entry price.

## Scaling path (not built)

Ingest Kraken's WebSocket feed into our own price table, push prices to clients, resolve from our table, add WAF, obtain a commercial data licence.

## Appendix A: Request flow

Player state (all three player endpoints):

```json
{
  "playerId": "6f1c…",
  "serverTime": "2026-11-02T14:00:01.320Z",
  "score": 3,
  "guessWindowMs": 60000,
  "maxGuessDelayMs": 5000,
  "activeGuess": {
    "state": "open",
    "direction": "up",
    "createdAt": "2026-11-02T14:00:00.500Z",
    "entryPrice": 76987.5,
    "entryTradeTime": "2026-11-02T14:00:00.400Z",
    "resolvableAt": "2026-11-02T14:01:00.500Z"
  },
  "history": [
    { "direction": "down", "createdAt": "…", "entryPrice": 77050.0, "decidingPrice": 77060.2, "decidingTradeTime": "…", "outcome": "lost" }
  ]
}
```

1. **Open page:** `GET /api/me` (empty state without header, `404` → start over) and `GET /api/price` every 2 s.
2. **Guess:** `POST /api/me/guess` → `201` with entry price, or *locking* (call resolve right away), `422` too late, `409` already active, timeout after 5 s → `GET /api/me`.
3. **Countdown:** no state requests until `resolvableAt`.
4. **Window ended:** `POST /api/me/guess/resolve` → resolved, *waiting*, or unchanged; repeat every 2 s until resolved.
5. **Tab visible again or return after days:** `GET /api/me`, then resolve at once if past `resolvableAt`.

Kraken is called only on a price cache miss, when placing a guess, and on resolve.
