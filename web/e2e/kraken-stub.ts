// A small stand-in for Kraken's public Trades endpoint with scripted prices (DECISIONS.md #18).
// Every request publishes a trade at the current price, like a busy market, so data is always complete.
// Tests control it with POST /control { price?, down?, reset? }.
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 3131)
const INITIAL_PRICE = 77_000

let price = INITIAL_PRICE
let krakenDown = false
let nextId = 1
let trades: { id: number; price: number; time: number }[] = []

/** Adds a trade at the current price and time, as if someone just traded on Kraken. */
function publishTrade() {
  const last = trades.at(-1)
  // Seconds with microseconds, strictly ascending.
  const time = Math.max(Date.now() / 1000, (last?.time ?? 0) + 0.000001)
  trades.push({ id: nextId++, price, time })
  if (trades.length > 5000) {
    trades = trades.slice(-2000)
  }
}

const toKrakenRow = (t: (typeof trades)[number]) => [
  t.price.toFixed(1),
  '0.01',
  t.time,
  'b',
  'l',
  '',
  t.id,
]

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (req.method === 'POST' && url.pathname === '/control') {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
    }
    const body = JSON.parse(raw || '{}') as {
      price?: number
      down?: boolean
      reset?: boolean
    }
    if (body.reset) {
      price = INITIAL_PRICE
      krakenDown = false
    }
    if (body.price !== undefined) {
      price = body.price
    }
    if (body.down !== undefined) {
      krakenDown = body.down
    }
    publishTrade()
    return send(200, { price, down: krakenDown })
  }

  if (url.pathname !== '/0/public/Trades') {
    return send(404, { error: ['EGeneral:Unknown method'] })
  }
  if (krakenDown) {
    return send(200, { error: ['EService:Unavailable'] })
  }

  publishTrade()
  const count = url.searchParams.get('count')
  const since = url.searchParams.get('since')
  let selected = trades
  if (count) {
    selected = trades.slice(-Number(count))
  } else if (since) {
    // Kraken accepts seconds or nanoseconds.
    const seconds = since.length > 12 ? Number(BigInt(since) / 1000n) / 1e6 : Number(since)
    selected = trades.filter((t) => t.time >= seconds).slice(0, 1000)
  }
  const last = selected.at(-1)
  send(200, {
    error: [],
    result: {
      XXBTZUSD: selected.map(toKrakenRow),
      last: last ? String(BigInt(Math.round(last.time * 1e6)) * 1000n) : (since ?? '0'),
    },
  })
}).listen(PORT, () => console.log(`kraken stub on ${PORT}`))
