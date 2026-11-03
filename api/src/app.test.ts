// API tests against DynamoDB Local (`npm run db`), with Kraken replaced by a test double and a
// controllable clock. They exercise the real condition expressions (DECISIONS.md #7, #18).
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import type { Config } from './config.ts'
import type { Prices } from './kraken.ts'
import type { Trade } from './rules.ts'
import { createDynamoClient, createStore, ensureLocalTable } from './store.ts'
import type { Direction, PlayerState } from './types.ts'

const config: Config = {
  guessWindowMs: 60_000,
  maxGuessDelayMs: 5_000,
  tableName: `test-${randomUUID()}`,
  dynamoEndpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
}
const db = createDynamoClient(config.dynamoEndpoint)
const store = createStore(db, config.tableName)

let now: number
let trades: Trade[]
let krakenDown: boolean
let nextId: number

/**
 * Adds a trade to the fake Kraken at `now + offsetMs`. Like on Kraken, a trade is published only
 * once the clock has passed its time; until then the API cannot see it.
 */
const addTrade = (offsetMs: number, price: number) => {
  trades.push({ id: nextId++, price, time: now + offsetMs })
  trades.sort((a, b) => a.time - b.time)
}
const publishedTrades = () => trades.filter((t) => t.time <= now)

/** Stands in for kraken.ts: serves `publishedTrades`, or fails like an outage when `krakenDown`. */
const prices: Prices = {
  async latestTrade() {
    if (krakenDown) {
      throw new Error('down')
    }
    const last = publishedTrades().at(-1)
    if (!last) {
      throw new Error('no trades')
    }
    return last
  },
  async *tradesSince(since) {
    if (krakenDown) {
      throw new Error('down')
    }
    yield publishedTrades().filter((t) => t.time >= since)
  },
}

const app = createApp({
  prices,
  store,
  config,
  clock: () => now,
  sleep: async (ms) => {
    now += ms
  },
})

const toIso = (ms: number) => new Date(ms).toISOString()

/** Sends a request to the app in-process (no HTTP server), with the player header if given. */
async function request(
  method: 'GET' | 'POST',
  path: string,
  opts: { playerId?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {}
  if (opts.playerId) {
    headers['X-Player-Id'] = opts.playerId
  }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
  }
  const res = await app.request(path, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
  })
  return {
    status: res.status,
    headers: res.headers,
    body: (await res.json()) as PlayerState & { error?: { code: string } },
  }
}

/** POST /api/me/guess. By default, the player saw a display price that is 1 s old. */
const postGuess = (direction: Direction, playerId?: string, seenPriceTime = toIso(now - 1000)) =>
  request('POST', '/api/me/guess', { playerId, body: { direction, seenPriceTime } })
const postResolve = (playerId: string) => request('POST', '/api/me/guess/resolve', { playerId })

/** Places a guess whose entry price is `entry` and returns the new player's ID. */
async function newPlayerWithGuess(direction: Direction, entry = 100) {
  addTrade(-500, entry)
  addTrade(100, entry) // published 100 ms after the guess, which completes the entry price
  const res = await postGuess(direction)
  expect(res.status).toBe(201)
  return res.body.playerId as string
}

beforeAll(() => ensureLocalTable(db, config.tableName))

beforeEach(() => {
  now = Date.UTC(2026, 10, 2, 14, 0, 0, 500)
  trades = []
  krakenDown = false
  nextId = 1
})

describe('GET /api/price', () => {
  it('returns the latest trade with times and a 1 s cache header', async () => {
    addTrade(-400, 76987.5)
    const res = await request('GET', '/api/price')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      price: 76987.5,
      tradeTime: toIso(now - 400),
      observedAt: toIso(now),
      serverTime: toIso(now),
    })
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=1, stale-if-error=86400')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('returns 503 without caching when Kraken is unavailable', async () => {
    krakenDown = true
    const res = await request('GET', '/api/price')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: { code: 'PRICE_UNAVAILABLE' } })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('GET /api/me', () => {
  it('returns the empty state of a new player without a header', async () => {
    const res = await request('GET', '/api/me')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      playerId: null,
      serverTime: toIso(now),
      score: 0,
      guessWindowMs: 60_000,
      maxGuessDelayMs: 5_000,
      activeGuess: null,
      history: [],
    })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns 404 for an unknown player and 400 for a malformed ID', async () => {
    expect((await request('GET', '/api/me', { playerId: randomUUID() })).status).toBe(404)
    expect((await request('GET', '/api/me', { playerId: 'not-a-uuid' })).status).toBe(400)
  })
})

describe('POST /api/me/guess', () => {
  it('creates the player with the first guess and locks the entry price', async () => {
    addTrade(-300, 100)
    addTrade(-100, 101) // last trade before the guess
    addTrade(200, 102) // published after the guess; completes the data

    const res = await postGuess('up')
    expect(res.status).toBe(201)
    expect(res.body.playerId).toMatch(/^[0-9a-f-]{36}$/)

    const createdAt = Date.UTC(2026, 10, 2, 14, 0, 0, 500)
    expect(res.body.activeGuess).toEqual({
      state: 'open',
      direction: 'up',
      createdAt: toIso(createdAt),
      entryPrice: 101,
      entryTradeTime: toIso(createdAt - 100),
      resolvableAt: toIso(createdAt + 60_000),
    })
    expect(res.body.score).toBe(0)

    const me = await request('GET', '/api/me', { playerId: res.body.playerId as string })
    expect(me.body.activeGuess).toEqual(res.body.activeGuess)
  })

  it('stays locking when the data is not complete within the entry budget, and resolve locks it later', async () => {
    addTrade(-300, 100)
    const res = await postGuess('down')
    expect(res.status).toBe(201)
    expect(res.body.activeGuess).toMatchObject({ state: 'locking', entryPrice: null })
    const playerId = res.body.playerId as string

    addTrade(1, 105) // a trade after the guess is published
    now += 10
    const resolved = await postResolve(playerId)
    expect(resolved.body.activeGuess).toMatchObject({ state: 'open', entryPrice: 100 })
  })

  it('stores the guess even when Kraken is unavailable', async () => {
    krakenDown = true
    const res = await postGuess('up')
    expect(res.status).toBe(201)
    expect(res.body.activeGuess?.state).toBe('locking')
  })

  it('rejects a guess based on an outdated price', async () => {
    const res = await postGuess('up', undefined, toIso(now - 5001))
    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: { code: 'PRICE_OUTDATED' } })
  })

  it('rejects a second active guess with 409', async () => {
    const playerId = await newPlayerWithGuess('up')
    const res = await postGuess('down', playerId)
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: { code: 'GUESS_ACTIVE' } })
  })

  it('accepts exactly one of two simultaneous guesses', async () => {
    const playerId = await newPlayerWithGuess('up')
    now += 61_000
    addTrade(-1, 110)
    addTrade(100, 110)
    expect((await postResolve(playerId)).body.activeGuess).toBeNull()

    const results = await Promise.all([postGuess('up', playerId), postGuess('down', playerId)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
  })

  it('returns 404 for an unknown player', async () => {
    expect((await postGuess('up', randomUUID())).status).toBe(404)
  })

  it.each([
    [{ direction: 'sideways', seenPriceTime: new Date().toISOString() }],
    [{ direction: 'up' }],
    [{ direction: 'up', seenPriceTime: 'yesterday' }],
    [{ direction: 'up', seenPriceTime: new Date().toISOString(), price: 1 }],
  ])('rejects the invalid body %j', async (body) => {
    const res = await request('POST', '/api/me/guess', { body })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: { code: 'INVALID_REQUEST' } })
  })

  it('rejects requests without a JSON content type, malformed JSON and oversized bodies', async () => {
    const send = (headers: Record<string, string>, body: string) =>
      app.request('/api/me/guess', { method: 'POST', headers, body })
    expect((await send({ 'Content-Type': 'text/plain' }, '{}')).status).toBe(400)
    expect((await send({ 'Content-Type': 'application/json' }, '{')).status).toBe(400)
    expect(
      (await send({ 'Content-Type': 'application/json' }, `{"x":"${'a'.repeat(2000)}"}`)).status,
    ).toBe(413)
  })
})

describe('POST /api/me/guess/resolve', () => {
  it('does nothing before the guess window has ended', async () => {
    const playerId = await newPlayerWithGuess('up')
    now += 59_000
    addTrade(-1, 200)
    const res = await postResolve(playerId)
    expect(res.body.activeGuess?.state).toBe('open')
    expect(res.body.score).toBe(0)
  })

  it('scores +1 once and records the history', async () => {
    const createdAt = now
    const playerId = await newPlayerWithGuess('up', 100)
    now = createdAt + 60_000
    addTrade(-2000, 103) // market price at the window end
    addTrade(500, 90)

    // Not complete yet: no trade after the window end is visible.
    expect((await postResolve(playerId)).body.activeGuess?.state).toBe('open')

    now += 1000
    const res = await postResolve(playerId)
    expect(res.body.score).toBe(1)
    expect(res.body.activeGuess).toBeNull()
    expect(res.body.history).toEqual([
      {
        direction: 'up',
        createdAt: toIso(createdAt),
        entryPrice: 100,
        decidingPrice: 103,
        decidingTradeTime: toIso(createdAt + 58_000),
        outcome: 'won',
      },
    ])

    // Repeated calls change nothing.
    expect((await postResolve(playerId)).body.score).toBe(1)
  })

  it('scores −1 and allows a negative score', async () => {
    const playerId = await newPlayerWithGuess('down', 100)
    now += 60_000
    addTrade(-1, 100.1)
    addTrade(1, 100.1)
    now += 10
    const res = await postResolve(playerId)
    expect(res.body.score).toBe(-1)
    expect(res.body.history[0]?.outcome).toBe('lost')
  })

  it('waits while the price equals the entry price, then the next different trade decides', async () => {
    const playerId = await newPlayerWithGuess('down', 100)
    now += 60_000
    addTrade(-1, 100)
    addTrade(1, 100)
    now += 10
    expect((await postResolve(playerId)).body.activeGuess?.state).toBe('waiting')
    expect((await request('GET', '/api/me', { playerId })).body.activeGuess?.state).toBe('waiting')

    addTrade(5000, 99)
    now += 6000
    const res = await postResolve(playerId)
    expect(res.body.score).toBe(1)
    expect(res.body.history[0]).toMatchObject({ decidingPrice: 99, outcome: 'won' })
  })

  it('resolves a locking guess after a return days later, with the same result', async () => {
    addTrade(-300, 100)
    krakenDown = true
    const placed = await postGuess('up')
    const playerId = placed.body.playerId as string

    krakenDown = false
    addTrade(30_000, 120) // market price at the window end
    addTrade(90_000, 80) // later moves do not count
    now += 3 * 24 * 60 * 60_000

    const res = await postResolve(playerId)
    expect(res.body.score).toBe(1)
    expect(res.body.history[0]).toMatchObject({ entryPrice: 100, decidingPrice: 120 })
  })

  it('counts simultaneous resolves only once', async () => {
    const playerId = await newPlayerWithGuess('up', 100)
    now += 60_000
    addTrade(-1, 101)
    addTrade(1, 101)
    now += 10
    await Promise.all([postResolve(playerId), postResolve(playerId), postResolve(playerId)])

    const me = await request('GET', '/api/me', { playerId })
    expect(me.body.score).toBe(1)
    expect(me.body.history).toHaveLength(1)
  })

  it('keeps the guess unchanged while Kraken is unavailable', async () => {
    const playerId = await newPlayerWithGuess('up')
    now += 61_000
    krakenDown = true
    const res = await postResolve(playerId)
    expect(res.status).toBe(200)
    expect(res.body.activeGuess?.state).toBe('open')
  })

  it('keeps only the last 10 guesses in the history', async () => {
    const playerId = await newPlayerWithGuess('up', 100)
    for (let i = 0; i < 11; i++) {
      now += 60_000
      addTrade(-1, 100 + i + 1)
      addTrade(1, 100 + i + 1)
      now += 10
      expect((await postResolve(playerId)).body.activeGuess).toBeNull()

      if (i < 10) {
        addTrade(-1, 100 + i + 1)
        addTrade(100, 100 + i + 1)
        expect((await postGuess('up', playerId)).status).toBe(201)
      }
    }

    const me = await request('GET', '/api/me', { playerId })
    expect(me.body.score).toBe(11)
    expect(me.body.history).toHaveLength(10)
  })

  it('returns the empty state without a header and 404 for an unknown player', async () => {
    expect((await request('POST', '/api/me/guess/resolve')).body.playerId).toBeNull()
    expect((await postResolve(randomUUID())).status).toBe(404)
  })
})
