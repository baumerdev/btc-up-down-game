# BTC Up/Down

A small web game: guess whether the Bitcoin price (BTC/USD) will be higher or lower in one minute. A correct guess scores +1, a wrong one −1. New players start at 0, and the score survives closing the browser.

## How it plays

- The current BTC price and your score are always visible.
- Pick **Up** or **Down**. While the guess is active, you can't place another one.
- After 60 seconds, the guess resolves as soon as the price differs from the entry price. If the price is unchanged at the 60 s mark, the guess waits until it moves.
- The last 10 guesses are listed with entry price, deciding price and time, so every result can be checked.
- English and German, light and dark theme.

Prices come from [Kraken](https://www.kraken.com/)'s public trade history. The server fetches all prices and sets all timestamps; the browser only sends "up" or "down". Entry and exit prices are the last trades before the guess and before the end of the window, so nobody can lock in an old price (see [DECISIONS.md](DECISIONS.md) #1–#4).

## Architecture

```text
Browser ── CloudFront ─┬─ /        → S3 (React build)
                       └─ /api/*   → API Gateway → Lambda (Hono) → DynamoDB
                                                       └──────────→ Kraken API
```

- `web/`: React, Vite, Tailwind CSS, TanStack Query
- `api/`: Hono on Node.js 24, Zod, AWS SDK v3. The same app runs as a local Node server and in Lambda.
- One DynamoDB table, keyed by an anonymous player ID. Game rules (one active guess, scored exactly once) are enforced with conditional writes.

The full request flow is in [DECISIONS.md, Appendix A](DECISIONS.md#appendix-a-request-flow).

## Run locally

Requirements: Node.js 24 (see `.nvmrc`) and Docker.

```sh
npm install
npm run dev
```

This starts DynamoDB Local in Docker, the API on <http://localhost:3030> and the frontend on <http://localhost:5173>. Vite proxies `/api` to the API, so the browser sees one origin as in production. Locally, the API calls the real Kraken API.

## Tests and checks

```sh
npm test           # unit and API tests (Vitest) against DynamoDB Local
npm run test:e2e   # end-to-end tests (Playwright) against the full local stack
npm run check      # Biome and type check
npm run format     # fix formatting
```

The end-to-end tests run the built frontend under the production Content Security Policy, against the real API and DynamoDB Local, with a stub that replaces Kraken. They shorten the guess window to 3 s, so every flow runs from click to result without waiting a minute. Install the browser once with `npx playwright install chromium`.

## Deployment

Not built yet. Planned (see [DECISIONS.md](DECISIONS.md) #5, #15, #16):

- Terraform for all AWS resources in `eu-central-1`, state in S3.
- GitHub Actions: checks and tests on every push and pull request; on `main`, `terraform apply`, upload of the frontend to S3 and a smoke test against the live URL.

## How I worked

I planned the project with an AI assistant (Claude Code) before any code was written, then let it build a complete first version from that plan, and reviewed the result. The first commit is the first complete version (without deployment); review fixes and the deployment follow as separate commits.

- [DECISIONS.md](DECISIONS.md): every product and technical decision, why it was made, and the alternatives
- [GLOSSARY.md](GLOSSARY.md): the domain terms used in code and docs

## License

[MIT](LICENSE). The bundled subset of the Archivo font (`web/src/fonts/`) is under the [SIL Open Font License](web/src/fonts/OFL.txt).
