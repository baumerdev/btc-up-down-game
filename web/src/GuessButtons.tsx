import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Game } from './game.ts'
import { useI18n } from './i18n.ts'

/**
 * Up and Down. Disabled with a reason, linked via aria-describedby (#23): placing, a guess is
 * active, paused, no price yet, or the price is delayed.
 */
export function GuessButtons({ game }: { game: Game }) {
  const { t } = useI18n()
  const { activeGuess } = game
  const secondsLeft = activeGuess
    ? Math.max(0, Math.ceil((Date.parse(activeGuess.resolvableAt) - game.serverNow) / 1000))
    : 0

  let disabledReason: string | null = null
  if (game.placingGuess) {
    disabledReason = t.placing
  } else if (activeGuess) {
    disabledReason =
      activeGuess.state === 'open' && secondsLeft > 0
        ? t.reasonActiveSeconds(secondsLeft)
        : t.reasonActive
  } else if (game.paused) {
    disabledReason = t.reasonPaused
  } else if (!game.displayPrice) {
    disabledReason = t.reasonNoPrice
  } else if (game.priceDelayed) {
    disabledReason = t.reasonDelayed
  }

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-3">
        {(['up', 'down'] as const).map((direction) => {
          const Icon = direction === 'up' ? ArrowUp : ArrowDown
          return (
            <button
              key={direction}
              type="button"
              disabled={disabledReason !== null}
              aria-describedby={disabledReason ? 'guess-reason' : 'guess-note'}
              onClick={() => game.placeGuess(direction)}
              className={`guess guess-${direction} inline-flex h-16 items-center justify-center gap-2 rounded-xl font-semibold text-lg`}
            >
              <Icon aria-hidden="true" size={22} strokeWidth={2.25} />
              {t.direction[direction]}
            </button>
          )
        })}
      </div>
      {disabledReason && (
        <p
          id="guess-reason"
          // The status area already shows placing and the countdown; screen readers still get
          // the reason with the disabled buttons (#23).
          className={game.placingGuess || activeGuess ? 'sr-only' : 'mt-3 text-sm'}
          data-testid="guess-reason"
        >
          {disabledReason}
        </p>
      )}
      <p id="guess-note" className="mt-3 max-w-prose text-ink-2 text-xs leading-relaxed">
        {t.receiptNote}
      </p>
    </div>
  )
}
