# BTC Up/Down

A small web game: guess whether the Bitcoin price (BTC/USD) will be higher or lower in one minute. A correct guess scores +1, a wrong one −1. New players start at 0, and the score survives closing the browser.

## How it plays

- The current BTC price and your score are always visible. After 5 minutes without any interaction and without an active guess, the price pauses with its last value and time; one click resumes it, so a forgotten tab doesn't keep polling.
- Pick **Up** or **Down**. While the guess is active, you can't place another one.
- After 60 seconds, the guess resolves as soon as the price differs from the entry price. If the price is unchanged at the 60 s mark, the guess waits until it moves.
- The last 10 guesses are listed with the time they were placed, the entry price and the deciding price, so every result can be checked.
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

Deployed from a laptop to AWS (`eu-central-1`) with Terraform; there is no CI/CD pipeline (see [DECISIONS.md](DECISIONS.md) #16). Requires Terraform, the AWS CLI and an AWS profile named `btc-updown`. Every command sets that profile explicitly, so a different default profile in the shell can't deploy into the wrong account.

1. Once, create the S3 bucket for the Terraform state:

   ```sh
   AWS_PROFILE=btc-updown terraform -chdir=infra/bootstrap init
   AWS_PROFILE=btc-updown terraform -chdir=infra/bootstrap apply
   ```

2. Create `infra/terraform.tfvars` (gitignored) with `budget_email = "you@example.com"`.
3. Run `infra/deploy.sh`. It builds everything, shows the Terraform plan and asks for confirmation, uploads the frontend, and smoke-tests the live URL.

To rotate the origin secret between CloudFront and the Lambda (expect a few minutes of `403` from the API while CloudFront updates):

```sh
AWS_PROFILE=btc-updown terraform -chdir=infra apply -replace=random_password.origin_secret
```

To remove everything, run the following. It needs the Lambda build and `terraform.tfvars`, because Terraform evaluates the whole configuration before destroying. The state bucket is protected and removed by hand.

```sh
npm run build -w api
AWS_PROFILE=btc-updown terraform -chdir=infra destroy
```

## How I worked

I planned the whole project with an AI assistant (Claude Code) before any code was written, then had it build a complete first version from that plan, and reviewed the result. The assistant researched, tested APIs and proposed implementations; the product decisions were mine, most of them made up front during planning rather than in response to its suggestions. For example:

- **Fairness first:** the server owns every price and timestamp, and the client never talks to the price API. I spotted that counting the *displayed* price would let a player watch a live chart elsewhere and lock in a stale price.
- **Fixed moments, not fixed waits:** the guess time and the end of the window are fixed in the database; delayed exchange data is handled by retrying for exactly those moments.
- **A real BTC/USD source whose terms allow this use**, checked before choosing it.
- **Load and abuse:** forgotten tabs must stop polling, the displayed price reaches the exchange about once per second regardless of player count, and a player is only created with their first guess.
- **Clean API semantics:** reading the player state never writes; advancing a guess is an explicit command.
- **Product scope:** no cancelling of guesses (players would cancel just before losing), English and German, light and dark themes, accessibility, and end-to-end tests with configurable timing.
- **Deployment:** AWS serverless with Terraform, and no public CI pipeline, so no workflow logs need guarding in a public repository.

**Kept simple on purpose:** no login (an anonymous ID in the browser), one DynamoDB table and one Lambda, polling instead of WebSockets, no price chart, no leaderboard, no cancelling of guesses, and no CI pipeline. The effort went where the game can be wrong: who owns prices and time, and that a guess can only be placed and scored once.

During review, several additional AI review passes (code, security, requirements) produced findings; I decided which to fix and which to accept. The first commit is the first complete version; the deployment and the review fixes follow as separate commits.

- [DECISIONS.md](DECISIONS.md): every product and technical decision, why it was made, and the alternatives
- [GLOSSARY.md](GLOSSARY.md): the domain terms used in code and docs

## License

[MIT](LICENSE). The bundled subset of the Archivo font (`web/src/fonts/`) is under the [SIL Open Font License](web/src/fonts/OFL.txt).
