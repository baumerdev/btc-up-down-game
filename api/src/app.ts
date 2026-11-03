// The HTTP API: four endpoints (DECISIONS.md #11, Appendix A). Combines the Kraken module
// (prices), the game rules (rules.ts) and DynamoDB (store.ts). Started by server.ts locally and by
// lambda.ts in AWS.
import { randomUUID } from 'node:crypto'
import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { Config } from './config.ts'
import type { Prices } from './kraken.ts'
import { marketPriceAt, resolveGuess, type Trade } from './rules.ts'
import type { GuessItem, PlayerItem, Store } from './store.ts'
import type { DisplayPrice, ErrorBody, ErrorCode, PlayerState } from './types.ts'

/**
 * How long POST /api/me/guess tries to find the entry price before answering with a *locking*
 * guess, and how often it retries in that time. After that, resolve takes over (#2).
 */
const ENTRY_PRICE_WAIT_MS = 1000
const ENTRY_PRICE_RETRY_MS = 300

/**
 * Where the search in Kraken's trade history starts, before the moment we need the market price
 * for. 10 s keeps a busy market within Kraken's page cap (kraken.ts); the entry price falls back
 * to 60 s and 1 h when a quiet market had no trade in the last 10 s (#25).
 */
const SEARCH_START_NEAR_MS = 10_000
const ENTRY_SEARCH_STARTS_MS = [SEARCH_START_NEAR_MS, 60_000, 60 * 60_000]

/** What the app needs from outside. Tests pass a fake price module and a controllable clock. */
export interface AppDependencies {
  prices: Prices
  store: Store
  config: Config
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Thrown in handlers; onError at the bottom turns it into `{ error: { code } }` (#11). */
class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
  ) {
    super(code)
  }
}

const GuessRequestBody = z.strictObject({
  direction: z.enum(['up', 'down']),
  seenPriceTime: z.iso.datetime(),
})
const PlayerIdSchema = z.uuid()

const toIso = (ms: number) => new Date(ms).toISOString()
const log = (fields: Record<string, unknown>) => console.log(JSON.stringify(fields))
/** Player IDs work like passwords and are never logged in full (#9). */
const shortPlayerId = (id: string | null | undefined) => (id ? `${id.slice(0, 8)}…` : undefined)

export function createApp({
  prices,
  store,
  config,
  clock = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: AppDependencies) {
  /**
   * Turns the player item from DynamoDB into the response of all three player endpoints (#11):
   * ISO times, the lifecycle state derived from the stored fields, `null` for missing values,
   * plus `serverTime` and the configured timings. Without a player: a new player's empty state.
   */
  const toPlayerState = (player: PlayerItem | undefined): PlayerState => {
    const guess = player?.activeGuess
    return {
      playerId: player?.playerId ?? null,
      serverTime: toIso(clock()),
      score: player?.score ?? 0,
      guessWindowMs: config.guessWindowMs,
      maxGuessDelayMs: config.maxGuessDelayMs,
      activeGuess: guess
        ? {
            state: guess.entryPrice === undefined ? 'locking' : guess.waiting ? 'waiting' : 'open',
            direction: guess.direction,
            createdAt: toIso(guess.createdAt),
            entryPrice: guess.entryPrice ?? null,
            entryTradeTime: guess.entryTradeTime === undefined ? null : toIso(guess.entryTradeTime),
            resolvableAt: toIso(guess.resolvableAt),
          }
        : null,
      history: (player?.history ?? []).map((h) => ({
        direction: h.direction,
        createdAt: toIso(h.createdAt),
        entryPrice: h.entryPrice,
        decidingPrice: h.decidingPrice,
        decidingTradeTime: toIso(h.decidingTradeTime),
        outcome: h.outcome,
      })),
    }
  }

  /**
   * Reads Kraken trades from the first start time and applies a rule from rules.ts to them:
   * `marketPriceAt` for the entry price, `resolveGuess` for the outcome.
   * Keeps reading pages while the rule answers "incomplete" or "waiting", because a later trade
   * can still change the answer. Moves to the next, earlier start time only when the rule answers
   * "needs-earlier" (no trade before the moment among those read).
   * Returns the rule's answer, or null if Kraken failed; the guess then stays as it is (#4).
   */
  const readTradeHistory = async <R extends { status: string }>(
    startTimes: number[],
    rule: (trades: Trade[]) => R,
  ): Promise<R | null> => {
    for (const since of startTimes) {
      const trades: Trade[] = []
      try {
        for await (const page of prices.tradesSince(since)) {
          trades.push(...page)
          const { status } = rule(trades)
          if (status !== 'incomplete' && status !== 'waiting') {
            break
          }
        }
      } catch (error) {
        log({ level: 'warn', msg: 'kraken trades failed', error: String(error) })
        return null
      }

      const result = rule(trades)
      if (result.status !== 'needs-earlier') {
        return result
      }
    }
    return null
  }

  /**
   * Finds the entry price, the market price at the guess's `createdAt` (#2), and stores it on
   * the active guess. Returns the guess with its entry price, or null while Kraken's data for
   * that moment is not complete yet.
   */
  const findEntryPrice = async (playerId: string, guess: GuessItem): Promise<GuessItem | null> => {
    const moment = guess.createdAt
    const result = await readTradeHistory(
      ENTRY_SEARCH_STARTS_MS.map((before) => moment - before),
      (trades) => marketPriceAt(trades, moment),
    )
    if (result?.status !== 'final') {
      return null
    }

    await store.setEntryPrice(playerId, guess.id, result.trade, clock())
    return { ...guess, entryPrice: result.trade.price, entryTradeTime: result.trade.time }
  }

  /**
   * The work behind POST /api/me/guess/resolve (#4): a *locking* guess gets its entry price;
   * once the guess window is over, the guess is resolved (score ±1, history) or marked waiting.
   * Stops at the first step whose data is not complete; the client calls again 2 s later.
   */
  const advanceActiveGuess = async (player: PlayerItem): Promise<void> => {
    let guess = player.activeGuess
    if (!guess) {
      return
    }

    if (guess.entryPrice === undefined) {
      const withEntry = await findEntryPrice(player.playerId, guess)
      if (!withEntry) {
        return
      }
      guess = withEntry
    }

    const { entryPrice, entryTradeTime } = guess
    if (entryPrice === undefined || entryTradeTime === undefined || clock() < guess.resolvableAt) {
      return
    }

    const rule = { direction: guess.direction, entryPrice, resolvableAt: guess.resolvableAt }
    // Search from just before the window end. Fallback: the entry trade, which is always before
    // the window end, so this second start never needs earlier data.
    const result = await readTradeHistory(
      [guess.resolvableAt - SEARCH_START_NEAR_MS, entryTradeTime - 1],
      (trades) => resolveGuess(trades, rule),
    )
    if (!result) {
      return
    }

    if (result.status === 'resolved') {
      await store.scoreGuess(
        player,
        guess.id,
        {
          direction: guess.direction,
          createdAt: guess.createdAt,
          entryPrice,
          decidingPrice: result.deciding.price,
          decidingTradeTime: result.deciding.time,
          outcome: result.outcome,
        },
        clock(),
      )
      log({
        msg: 'guess resolved',
        player: shortPlayerId(player.playerId),
        outcome: result.outcome,
      })
    } else if (result.status === 'waiting' && !guess.waiting) {
      await store.markWaiting(player.playerId, guess.id, clock())
    }
  }

  /** The player ID from the `X-Player-Id` header (#9): null without header, 400 if not a UUID. */
  const playerIdFromHeader = (c: Context): string | null => {
    const raw = c.req.header('x-player-id')
    if (raw === undefined) {
      return null
    }
    if (!PlayerIdSchema.safeParse(raw).success) {
      throw new ApiError(400, 'INVALID_REQUEST')
    }
    return raw
  }

  /** Reads the player from DynamoDB; 404 if the ID is unknown (expired after a year, #10). */
  const getExistingPlayer = async (playerId: string): Promise<PlayerItem> => {
    const player = await store.getPlayer(playerId)
    if (!player) {
      throw new ApiError(404, 'PLAYER_NOT_FOUND')
    }
    return player
  }

  const app = new Hono()

  // Every response: Cache-Control no-store unless the route set its own (only /api/price, #8),
  // and one JSON log line.
  app.use(async (c, next) => {
    const started = clock()
    await next()
    if (!c.res.headers.has('Cache-Control')) {
      c.res.headers.set('Cache-Control', 'no-store')
    }
    log({
      msg: 'request',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: clock() - started,
      player: shortPlayerId(c.req.header('x-player-id')),
    })
  })

  // POST only with a JSON body: a foreign site cannot send that without a CORS preflight,
  // which fails because the API sends no CORS headers (#14).
  app.use(async (c, next) => {
    if (c.req.method === 'POST' && !c.req.header('content-type')?.startsWith('application/json')) {
      throw new ApiError(400, 'INVALID_REQUEST')
    }
    await next()
  })

  app.use(
    bodyLimit({
      maxSize: 1024,
      onError: () => {
        throw new ApiError(413, 'INVALID_REQUEST')
      },
    }),
  )

  app.get('/api/price', async (c) => {
    let trade: Trade
    try {
      trade = await prices.latestTrade()
    } catch (error) {
      log({ level: 'warn', msg: 'kraken latest trade failed', error: String(error) })
      throw new ApiError(503, 'PRICE_UNAVAILABLE')
    }

    const now = clock()
    const body: DisplayPrice = {
      price: trade.price,
      tradeTime: toIso(trade.time),
      observedAt: toIso(now),
      serverTime: toIso(now),
    }
    // CloudFront caches this for 1 s, and serves the last good response while Kraken fails.
    // The client then sees an old observedAt and shows "Delayed" (#8, #12).
    return c.json(body, 200, { 'Cache-Control': 'public, max-age=1, stale-if-error=86400' })
  })

  // Read-only: never writes, never calls Kraken. No header means a new player (#9, #11).
  app.get('/api/me', async (c) => {
    const playerId = playerIdFromHeader(c)
    return c.json(toPlayerState(playerId ? await getExistingPlayer(playerId) : undefined))
  })

  app.post(
    '/api/me/guess',
    zValidator('json', GuessRequestBody, (result) => {
      if (!result.success) {
        throw new ApiError(400, 'INVALID_REQUEST')
      }
    }),
    async (c) => {
      const headerPlayerId = playerIdFromHeader(c)
      const { direction, seenPriceTime } = c.req.valid('json')

      // The display price the player decided on must be recent enough (#22).
      const now = clock()
      if (now - Date.parse(seenPriceTime) > config.maxGuessDelayMs) {
        throw new ApiError(422, 'PRICE_OUTDATED')
      }

      const guess: GuessItem = {
        id: randomUUID(),
        direction,
        createdAt: now,
        resolvableAt: now + config.guessWindowMs,
      }

      // Existing player: add the guess if none is active (#7). No header: create the player
      // together with the guess (#9).
      let playerId = headerPlayerId
      if (playerId) {
        const placed = await store.placeGuess(playerId, guess, now)
        if (placed === 'not-found') {
          throw new ApiError(404, 'PLAYER_NOT_FOUND')
        }
        if (placed === 'active') {
          throw new ApiError(409, 'GUESS_ACTIVE')
        }
      } else {
        playerId = randomUUID()
        await store.createPlayerWithGuess(playerId, guess, now)
      }
      log({
        msg: 'guess placed',
        player: shortPlayerId(playerId),
        direction,
        newPlayer: !headerPlayerId,
      })

      // The guess is stored. Try the entry price for a short while; if Kraken is slow or down,
      // the guess is returned as *locking* and resolve finds the price later (#2).
      while (
        !(await findEntryPrice(playerId, guess)) &&
        clock() + ENTRY_PRICE_RETRY_MS < now + ENTRY_PRICE_WAIT_MS
      ) {
        await sleep(ENTRY_PRICE_RETRY_MS)
      }
      return c.json(toPlayerState(await store.getPlayer(playerId)), 201)
    },
  )

  app.post('/api/me/guess/resolve', async (c) => {
    const playerId = playerIdFromHeader(c)
    if (!playerId) {
      return c.json(toPlayerState(undefined))
    }
    await advanceActiveGuess(await getExistingPlayer(playerId))
    return c.json(toPlayerState(await store.getPlayer(playerId)))
  })

  app.notFound((c) => c.json<ErrorBody>({ error: { code: 'NOT_FOUND' } }, 404))

  // Errors leave the API only as a code, never with details or stack traces (#11, #14).
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json<ErrorBody>({ error: { code: error.code } }, error.status)
    }
    // Hono's own client errors, for example malformed JSON.
    if (error instanceof HTTPException && error.status < 500) {
      return c.json<ErrorBody>({ error: { code: 'INVALID_REQUEST' } }, 400)
    }
    log({ level: 'error', msg: 'unhandled', error: String(error), stack: error.stack })
    return c.json<ErrorBody>({ error: { code: 'INTERNAL' } }, 500)
  })

  return app
}
