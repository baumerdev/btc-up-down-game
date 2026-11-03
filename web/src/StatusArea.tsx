import { Play, RotateCw } from 'lucide-react'
import type { Game } from './game.ts'
import { useI18n } from './i18n.ts'

/**
 * The one place for all feedback (#17): what is happening now, a countdown or busy bar below it,
 * and a Resume or Retry button. Earlier branches win: pause, then errors, then the guess.
 */
export function StatusArea({ game }: { game: Game }) {
  const { t, f } = useI18n()
  const { activeGuess, revealedResult, serverNow } = game
  const windowMs = game.player?.guessWindowMs ?? 60_000
  const msUntilWindowEnd = activeGuess ? Date.parse(activeGuess.resolvableAt) - serverNow : 0
  const windowOver = activeGuess?.state === 'open' && msUntilWindowEnd <= 0

  let message: React.ReactNode
  let action: React.ReactNode = null
  // The bar below the message: a countdown while the window runs, an indeterminate bar while
  // the server works (placing, locking, checking, waiting), nothing otherwise.
  let progressBar: 'countdown' | 'busy' | null = null

  if (game.paused) {
    message = t.pausedMessage
    action = (
      <StatusActionButton
        icon={<Play size={16} aria-hidden="true" />}
        label={t.resume}
        onClick={game.resume}
      />
    )
  } else if (game.notice || game.playerLoadFailed) {
    const code = game.notice ?? 'NETWORK'
    message = (t.errors as Record<string, string>)[code] ?? t.errors.generic
    if (code === 'NETWORK' || !(code in t.errors)) {
      action = (
        <StatusActionButton
          icon={<RotateCw size={16} aria-hidden="true" />}
          label={t.retry}
          onClick={game.retry}
        />
      )
    }
  } else if (game.placingGuess) {
    message = t.placing
    progressBar = 'busy'
  } else if (activeGuess) {
    const direction = t.direction[activeGuess.direction]
    progressBar = 'busy'
    if (activeGuess.state === 'locking') {
      // Locking can take long in a quiet market or while Kraken is down (#4), so say so in steps.
      const elapsed = serverNow - Date.parse(activeGuess.createdAt)
      message =
        msUntilWindowEnd <= 0
          ? t.lockingPastEnd(Math.round(windowMs / 1000))
          : elapsed >= 24_000
            ? t.lockingStalled
            : elapsed >= 16_000
              ? t.lockingSlower
              : elapsed >= 8_000
                ? t.lockingSlow(direction)
                : t.locking(direction)
    } else if (windowOver) {
      message = t.checking
    } else if (activeGuess.state === 'waiting') {
      message = (
        <>
          <span className="block font-medium">{t.waiting}</span>
          <span className="mt-1 block text-ink-2 text-sm">{t.waitingDetail}</span>
        </>
      )
    } else {
      message = (
        <span className="font-medium">
          {t.locked(direction, f.usd(activeGuess.entryPrice ?? 0))}
        </span>
      )
      progressBar = 'countdown'
    }
  } else if (revealedResult) {
    const won = revealedResult.outcome === 'won'
    message = (
      <span className="flex items-center gap-4">
        <span
          className={`reveal font-display font-semibold text-5xl tabular-nums ${won ? 'text-up' : 'text-down'}`}
          data-testid="reveal"
        >
          {f.signed(won ? 1 : -1)}
        </span>
        <span>
          <span className="block font-medium">{won ? t.won : t.lost}</span>
          <span className="block text-ink-2 text-sm tabular-nums">
            {t.move(
              t.direction[revealedResult.direction],
              f.usd(revealedResult.entryPrice),
              f.usd(revealedResult.decidingPrice),
            )}
          </span>
        </span>
      </span>
    )
  } else {
    message = <span className="text-ink-2">{t.intro(Math.round(windowMs / 1000))}</span>
  }

  return (
    <section
      className="flex min-h-28 flex-col justify-center border-rule border-y py-4"
      data-testid="status"
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
      {progressBar && (
        <div
          className="mt-3 flex items-center gap-3"
          aria-hidden="true"
          data-testid={`bar-${progressBar}`}
        >
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-rule">
            {progressBar === 'countdown' ? (
              <div
                className="h-full origin-left rounded-full bg-ink"
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(1, msUntilWindowEnd / windowMs))})`,
                }}
              />
            ) : (
              <div className="busy-bar h-full rounded-full bg-ink" />
            )}
          </div>
          {/* Same width in both modes, so the bar does not jump when the countdown ends. */}
          <span className="w-16 text-right text-ink-2 text-sm tabular-nums">
            {progressBar === 'countdown' &&
              t.secondsLeft(Math.max(0, Math.ceil(msUntilWindowEnd / 1000)))}
          </span>
        </div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </section>
  )
}

function StatusActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-rule px-4 font-medium text-sm transition-colors hover:border-ink"
    >
      {icon}
      {label}
    </button>
  )
}
