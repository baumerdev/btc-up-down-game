// The game rules as pure functions over Kraken trades (DECISIONS.md #2, #4). No I/O: app.ts reads
// the trades (kraken.ts) and passes them in, and stores what the rules decide (store.ts).
import type { Direction, Outcome } from './types.ts'

/** One BTC/USD trade, as kraken.ts returns it. */
export interface Trade {
  id: number
  price: number
  /** Unix epoch in milliseconds, with Kraken's sub-millisecond fraction kept (#4 Precision). */
  time: number
}

/** Answer of `marketPriceAt`. app.ts reads more trades on "incomplete" and "needs-earlier". */
export type MarketPrice =
  | { status: 'final'; trade: Trade }
  /** No trade after the moment among the trades yet. Kraken may still publish one up to the moment. */
  | { status: 'incomplete' }
  /** All trades are after the moment. Search again from an earlier start time. */
  | { status: 'needs-earlier' }

/**
 * The market price at `moment` (GLOSSARY.md): the last trade at or before it, at full precision.
 * Used for the entry price (moment = `createdAt`) and inside `resolveGuess` (moment = window end).
 * Final only once a trade after the moment is visible, because Kraken publishes trades in order
 * (#4 Completeness). `trades` must be in ascending order.
 */
export function marketPriceAt(trades: Trade[], moment: number): MarketPrice {
  const firstAfter = trades.findIndex((t) => t.time > moment)
  if (firstAfter === -1) {
    return { status: 'incomplete' }
  }
  const last = trades[firstAfter - 1]
  return last ? { status: 'final', trade: last } : { status: 'needs-earlier' }
}

/** Answer of `resolveGuess`. app.ts scores "resolved", stores "waiting", and retries the rest later. */
export type Resolution =
  | { status: 'resolved'; deciding: Trade; outcome: Outcome }
  /** The market price at the window end equals the entry price, and no later trade differs yet. */
  | { status: 'waiting' }
  | { status: 'incomplete' }
  | { status: 'needs-earlier' }

/**
 * Decides a guess (#4): the market price at the end of the guess window (`resolvableAt`) against
 * the entry price. If both are equal, the first later trade with a different price decides.
 * Up wins if the deciding price is higher, down if it is lower.
 */
export function resolveGuess(
  trades: Trade[],
  guess: { direction: Direction; entryPrice: number; resolvableAt: number },
): Resolution {
  const atWindowEnd = marketPriceAt(trades, guess.resolvableAt)
  if (atWindowEnd.status !== 'final') {
    return atWindowEnd
  }

  const deciding =
    atWindowEnd.trade.price !== guess.entryPrice
      ? atWindowEnd.trade
      : trades.find((t) => t.time > guess.resolvableAt && t.price !== guess.entryPrice)
  if (!deciding) {
    return { status: 'waiting' }
  }

  const wentUp = deciding.price > guess.entryPrice
  return {
    status: 'resolved',
    deciding,
    outcome: wentUp === (guess.direction === 'up') ? 'won' : 'lost',
  }
}
