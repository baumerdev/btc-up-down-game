// The last 10 resolved guesses with entry price, deciding price and time, so every result can be
// checked (DECISIONS.md #10). Data: `history` of the player state from the API. A plain list (#24).
import type { HistoryEntry } from 'api/types'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useI18n } from './i18n.ts'

export function History({ history }: { history: HistoryEntry[] }) {
  const { t, f } = useI18n()
  return (
    <section aria-labelledby="history-title" className="mt-14 px-1 sm:px-2">
      <h2 id="history-title" className="mb-3 font-semibold text-base">
        {t.historyTitle}
      </h2>
      {history.length === 0 ? (
        <p className="max-w-prose text-ink-2 text-sm">{t.historyEmpty}</p>
      ) : (
        <ol className="divide-y divide-rule border-rule border-y" data-testid="history">
          {history.map((h) => {
            const Icon = h.direction === 'up' ? ArrowUp : ArrowDown
            const won = h.outcome === 'won'
            return (
              <li
                key={h.createdAt}
                className="grid grid-cols-[4.75rem_1fr_auto] sm:grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 py-3 text-sm"
              >
                <span className="inline-flex items-center gap-1.5 self-center font-medium">
                  <Icon aria-hidden="true" size={15} />
                  {t.direction[h.direction]}
                </span>
                <span className="min-w-0">
                  <span className="block tabular-nums">
                    <span className="whitespace-nowrap">{f.usd(h.entryPrice)}</span> →{' '}
                    <span className="whitespace-nowrap">{f.usd(h.decidingPrice)}</span>
                  </span>
                  {/* When the guess was placed. The deciding trade can be from before the
                      window ended (#4), which would read as "decided too early". */}
                  <time className="block text-ink-2 text-xs" dateTime={h.createdAt}>
                    {f.dateTime(h.createdAt)}
                  </time>
                </span>
                <span
                  className={`text-right font-medium tabular-nums ${won ? 'text-up' : 'text-down'}`}
                >
                  {f.signed(won ? 1 : -1)}{' '}
                  <span className="sr-only font-normal sm:not-sr-only">{t.outcome[h.outcome]}</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
