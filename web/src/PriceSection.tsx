import type { Direction } from 'api/types'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Game } from './game.ts'
import { useI18n } from './i18n.ts'

/** The display price with Live / Delayed / Paused, and the entry price while a guess is active. */
export function PriceSection({ game }: { game: Game }) {
  const { t, f } = useI18n()
  const price = game.displayPrice
  // The price turns green or red for 0.7 s when it changes (#24).
  const [flashDirection, setFlashDirection] = useState<Direction | null>(null)
  const previousPrice = useRef(price?.price)

  useEffect(() => {
    const before = previousPrice.current
    previousPrice.current = price?.price
    if (price === undefined || before === undefined || price.price === before) {
      return
    }
    setFlashDirection(price.price > before ? 'up' : 'down')
    const id = setTimeout(() => setFlashDirection(null), 700)
    return () => clearTimeout(id)
  }, [price])

  const feedStatus = game.paused ? 'paused' : game.priceDelayed ? 'delayed' : 'live'
  const entryPrice = game.activeGuess?.entryPrice ?? null
  const changeSinceEntry = entryPrice !== null && price ? price.price - entryPrice : null

  return (
    <section aria-label={t.pair} className="price-box mt-12 mb-10 sm:mt-16">
      <p
        className={`price font-display font-semibold tabular-nums transition-colors duration-700 ${
          flashDirection === 'up'
            ? 'text-up'
            : flashDirection === 'down'
              ? 'text-down'
              : feedStatus !== 'live'
                ? 'text-ink-2'
                : 'text-ink'
        }`}
        data-testid="price"
      >
        {price ? f.usd(price.price) : <span className="text-ink-2">—</span>}
      </p>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2 text-sm">
        <span
          className="inline-flex items-center gap-1.5 font-medium text-ink"
          data-testid="feed-status"
        >
          <span aria-hidden="true" className={`dot dot-${feedStatus}`} />
          {t[feedStatus]}
        </span>
        <span aria-hidden="true">·</span>
        <span>{t.pair}</span>
        {price && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {t.lastTrade} <time dateTime={price.tradeTime}>{f.time(price.tradeTime)}</time>
            </span>
          </>
        )}
        {!price && <span>{t.loadingPrice}</span>}
      </p>
      {entryPrice !== null && (
        <p className="mt-5 flex flex-wrap items-baseline gap-x-3 text-sm" data-testid="entry">
          <span className="text-ink-2">{t.entry}</span>
          <span className="font-medium tabular-nums">{f.usd(entryPrice)}</span>
          {changeSinceEntry !== null && changeSinceEntry !== 0 && (
            <span
              className={`inline-flex items-center gap-1 tabular-nums ${changeSinceEntry > 0 ? 'text-up' : 'text-down'}`}
            >
              {changeSinceEntry > 0 ? (
                <ArrowUp aria-hidden="true" size={14} />
              ) : (
                <ArrowDown aria-hidden="true" size={14} />
              )}
              {f.signedUsd(changeSinceEntry)}
            </span>
          )}
        </p>
      )}
    </section>
  )
}
