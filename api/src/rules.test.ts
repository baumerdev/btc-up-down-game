import { describe, expect, it } from 'vitest'
import { marketPriceAt, resolveGuess, type Trade } from './rules.ts'

// Times in ms relative to an arbitrary moment T.
const T = Date.UTC(2026, 10, 2, 14, 0, 0, 500)
let nextId = 1
const trade = (offsetMs: number, price: number): Trade => ({
  id: nextId++,
  price,
  time: T + offsetMs,
})

describe('marketPriceAt', () => {
  it('takes the last trade at or before the moment, at sub-second precision', () => {
    // The example from DECISIONS.md #4: guess at .500, trades at .200, .400, .700, .900.
    const trades = [trade(-300, 1), trade(-100, 2), trade(200, 3), trade(400, 4)]
    expect(marketPriceAt(trades, T)).toEqual({ status: 'final', trade: trades[1] })
  })

  it('counts a trade exactly at the moment', () => {
    const trades = [trade(-1000, 1), trade(0, 2), trade(1, 3)]
    expect(marketPriceAt(trades, T)).toMatchObject({ status: 'final', trade: { price: 2 } })
  })

  it('keeps sub-millisecond differences', () => {
    const trades = [trade(-0.4, 1), trade(0.3, 2)]
    expect(marketPriceAt(trades, T)).toMatchObject({ status: 'final', trade: { price: 1 } })
  })

  it('takes the last of several trades within the same millisecond before the moment', () => {
    const trades = [trade(-5, 1), trade(-5, 2), trade(-5, 3), trade(10, 4)]
    expect(marketPriceAt(trades, T)).toMatchObject({ status: 'final', trade: { price: 3 } })
  })

  it('is incomplete until a trade after the moment is visible', () => {
    expect(marketPriceAt([trade(-200, 1), trade(0, 2)], T)).toEqual({ status: 'incomplete' })
    expect(marketPriceAt([], T)).toEqual({ status: 'incomplete' })
  })

  it('needs earlier data when no trade at or before the moment is included', () => {
    expect(marketPriceAt([trade(1, 1), trade(2, 2)], T)).toEqual({ status: 'needs-earlier' })
  })

  it('uses a trade long before the moment in a quiet market', () => {
    const trades = [trade(-50_000, 7), trade(20_000, 8)]
    expect(marketPriceAt(trades, T)).toMatchObject({ status: 'final', trade: { price: 7 } })
  })
})

describe('resolveGuess', () => {
  const end = T + 60_000
  const up = { direction: 'up' as const, entryPrice: 100, resolvableAt: end }
  const down = { ...up, direction: 'down' as const }

  it('decides by the market price at exactly the end of the window', () => {
    const trades = [trade(0, 100), trade(58_000, 101), trade(60_000, 102), trade(60_001, 50)]
    expect(resolveGuess(trades, up)).toMatchObject({
      status: 'resolved',
      outcome: 'won',
      deciding: { price: 102 },
    })
    expect(resolveGuess(trades, down)).toMatchObject({ status: 'resolved', outcome: 'lost' })
  })

  it('counts a move at 58 s', () => {
    const trades = [trade(0, 100), trade(58_000, 99), trade(61_000, 99)]
    expect(resolveGuess(trades, down)).toMatchObject({
      status: 'resolved',
      outcome: 'won',
      deciding: { price: 99 },
    })
  })

  it('waits while the price at the window end equals the entry price', () => {
    const trades = [trade(0, 100), trade(30_000, 101), trade(59_000, 100), trade(61_000, 100)]
    expect(resolveGuess(trades, up)).toEqual({ status: 'waiting' })
  })

  it('lets the first later trade with a different price decide after waiting', () => {
    const trades = [
      trade(0, 100),
      trade(59_000, 100),
      trade(65_000, 100),
      trade(300_000, 99.9),
      trade(300_001, 120),
    ]
    expect(resolveGuess(trades, up)).toMatchObject({
      status: 'resolved',
      outcome: 'lost',
      deciding: { price: 99.9 },
    })
  })

  it('is incomplete until a trade after the window end is visible', () => {
    expect(resolveGuess([trade(0, 100), trade(59_000, 110)], up)).toEqual({ status: 'incomplete' })
  })

  it('reports needs-earlier when the trades start after the window end', () => {
    expect(resolveGuess([trade(61_000, 110)], up)).toEqual({ status: 'needs-earlier' })
  })
})
