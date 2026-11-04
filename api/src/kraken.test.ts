// The Kraken adapter against a mocked fetch: paging, cursor, repeated trades, and untrusted data (#3, #14).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latestTrade, tradesSince } from './kraken.ts'

/** One trade in Kraken's response format: [price, volume, time (s), side, type, misc, trade id]. */
type KrakenRow = [string, string, number, string, string, string, number]

const krakenRow = (id: number, seconds: number, price = '100.0'): KrakenRow => [
  price,
  '0.01',
  seconds,
  'b',
  'l',
  '',
  id,
]

/** Responses the mocked fetch returns, one per call, in order. */
let queuedResponses: unknown[]
/** URLs kraken.ts requested, to check the query parameters. */
let requestedUrls: string[]

beforeEach(() => {
  queuedResponses = []
  requestedUrls = []
  vi.stubGlobal('fetch', async (url: string) => {
    requestedUrls.push(url)
    return Response.json(queuedResponses.shift())
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A successful Trades response with the given rows and cursor. */
const krakenPage = (rows: KrakenRow[], last: string) => ({
  error: [],
  result: { XXBTZUSD: rows, last },
})

/** Reads `tradesSince` to the end and returns the pages it yielded. */
const readAllPages = async (time: number) => {
  const pages = []
  for await (const p of tradesSince(time)) {
    pages.push(p)
  }
  return pages
}

/** A trade time in seconds, within the range kraken.ts accepts as plausible. */
const T = 1_780_000_000

describe('tradesSince', () => {
  it('sends `since` in nanoseconds and stops after a short page', async () => {
    queuedResponses = [krakenPage([krakenRow(1, T + 0.5)], '1')]
    const pages = await readAllPages(T * 1000 + 0.9)
    expect(requestedUrls[0]).toContain(`since=${T}000000000`)
    expect(pages).toEqual([[{ id: 1, price: 100, time: T * 1000 + 500 }]])
  })

  it('follows the cursor across full pages and drops the repeated last trade', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => krakenRow(i + 1, T + i / 1000))
    queuedResponses = [
      krakenPage(full, '1793646018261680600'),
      krakenPage([krakenRow(1000, T + 0.999), krakenRow(1001, T + 1)], '1793646019261680600'),
    ]
    const pages = await readAllPages(T * 1000)

    expect(requestedUrls[1]).toContain('since=1793646018261680600')
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(1000)
    expect(pages[1]?.map((t) => t.id)).toEqual([1001])
  })

  it('reads at most 5 pages per call', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => krakenRow(i + 1, T + i / 1000))
    queuedResponses = Array(6).fill(krakenPage(full, '1793646018261680600'))
    await readAllPages(T * 1000)
    expect(requestedUrls).toHaveLength(5)
  })
})

describe('untrusted data is treated as an outage', () => {
  it.each([
    ['an error body', { error: ['EService:Unavailable'] }],
    ['a non-positive price', krakenPage([krakenRow(1, T, '0')], '1')],
    ['a price that is not a number', krakenPage([krakenRow(1, T, 'abc')], '1')],
    ['a trade time before 2013', krakenPage([krakenRow(1, 1_000_000)], '1')],
    ['a trade time in the future', krakenPage([krakenRow(1, Date.now() / 1000 + 3600)], '1')],
    ['a row of the wrong shape', krakenPage([['100.0', T] as unknown as KrakenRow], '1')],
    ['a cursor that is not a number', krakenPage([krakenRow(1, T)], '1&pair=X')],
  ])('rejects %s', async (_, body) => {
    queuedResponses = [body]
    await expect(readAllPages(T * 1000)).rejects.toThrow()
  })

  it('rejects an HTTP error', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 502 }))
    await expect(latestTrade()).rejects.toThrow('Kraken HTTP 502')
  })
})

describe('latestTrade', () => {
  it('asks for one trade and returns it', async () => {
    queuedResponses = [krakenPage([krakenRow(7, T, '76987.5')], '1')]
    expect(await latestTrade()).toEqual({ id: 7, price: 76987.5, time: T * 1000 })
    expect(requestedUrls[0]).toContain('count=1')
  })

  it('fails without trades', async () => {
    queuedResponses = [krakenPage([], '0')]
    await expect(latestTrade()).rejects.toThrow('no trades')
  })
})
