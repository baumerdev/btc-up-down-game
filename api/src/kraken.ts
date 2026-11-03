// The only place that talks to Kraken (DECISIONS.md #3): URL, pair, response format, paging and
// errors. app.ts uses the two exported functions; the tests replace them with a fake.
import { z } from 'zod'
import type { Trade } from './rules.ts'

// Fixed in code; only the end-to-end tests point it at their local stub (web/e2e). Never client input.
const BASE_URL = process.env.KRAKEN_BASE_URL ?? 'https://api.kraken.com'
const PAIR = 'XBTUSD'
/** Kraken names the pair differently in the response than in the request. */
const RESULT_KEY = 'XXBTZUSD'
const TIMEOUT_MS = 2000
/** Trades per page; Kraken's fixed maximum. A shorter page means there are no more trades yet. */
const PAGE_SIZE = 1000
/**
 * Pages per `tradesSince` call, to stay near Kraken's limit of about 1 call/s (#3). Every resolve
 * call starts the search again, so more than ~5,000 trades between the search start and the
 * deciding trade would leave a guess locking or waiting. Store a cursor on the guess if that happens.
 */
const MAX_PAGES = 5

// One trade as Kraken sends it: [price, volume, time (s, fractional), side, type, misc, trade id]
const TradeRow = z.tuple([
  z.string(),
  z.string(),
  z.number(),
  z.string(),
  z.string(),
  z.string(),
  z.number(),
])
const TradesResponse = z.object({
  error: z.array(z.string()),
  result: z.object({ [RESULT_KEY]: z.array(TradeRow), last: z.string() }).optional(),
})

/**
 * One call to Kraken's Trades endpoint. Returns the trades and Kraken's cursor for the next page.
 * Throws on HTTP errors, Kraken errors and implausible data; callers treat that as an outage.
 */
async function fetchTradesPage(query: string): Promise<{ trades: Trade[]; cursor: string }> {
  const res = await fetch(`${BASE_URL}/0/public/Trades?pair=${PAIR}&${query}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Kraken HTTP ${res.status}`)
  }

  const body = TradesResponse.parse(await res.json())
  if (body.error.length > 0 || !body.result) {
    throw new Error(`Kraken error: ${body.error.join(', ')}`)
  }

  const now = Date.now()
  const trades = body.result[RESULT_KEY].map(([price, , seconds, , , , id]) => {
    const trade = { id, price: Number(price), time: seconds * 1000 }
    // Untrusted data (#14): positive prices and plausible times only.
    if (!(trade.price > 0 && Number.isFinite(trade.price))) {
      throw new Error('Kraken: invalid price')
    }
    if (!(trade.time > Date.UTC(2013, 0) && trade.time < now + 60_000)) {
      throw new Error('Kraken: implausible trade time')
    }
    return trade
  })

  return { trades, cursor: body.result.last }
}

/** The most recent trade. Used by GET /api/price for the display price. */
export async function latestTrade(): Promise<Trade> {
  const { trades } = await fetchTradesPage('count=1')
  const trade = trades.at(-1)
  if (!trade) {
    throw new Error('Kraken: no trades')
  }
  return trade
}

/**
 * Trades from `time` (epoch ms) onwards, in ascending order, one page per loop iteration. Used by
 * app.ts for entry prices and outcomes; it stops reading as soon as a rule has its answer.
 * Kraken's `since` takes nanoseconds. Its cursor repeats the last trade of the previous page,
 * so trades already returned are dropped.
 */
export async function* tradesSince(time: number): AsyncGenerator<Trade[]> {
  let since = String(BigInt(Math.floor(time)) * 1_000_000n)
  let lastId = -1

  for (let page = 0; page < MAX_PAGES; page++) {
    const { trades, cursor } = await fetchTradesPage(`since=${since}`)
    const newTrades = trades.filter((t) => t.id > lastId)
    if (newTrades.length > 0) {
      yield newTrades
    }

    if (trades.length < PAGE_SIZE) {
      return
    }
    lastId = trades.at(-1)?.id ?? lastId
    since = cursor
  }
}

export const kraken = { latestTrade, tradesSince }
/** The shape app.ts expects from a price module: Kraken in production, a fake in tests. */
export type Prices = typeof kraken
