// The one screen (DECISIONS.md #17, #23, #24): price, status area, guess buttons, history, footer.
// All state and requests come from useGame (game.ts); the components only decide what to show.
import { Footer } from './Footer.tsx'
import { GuessButtons } from './GuessButtons.tsx'
import { useGame } from './game.ts'
import { History } from './History.tsx'
import { useI18n } from './i18n.ts'
import { PriceSection } from './PriceSection.tsx'
import { StatusArea } from './StatusArea.tsx'

export function App() {
  const game = useGame()
  const { t, f } = useI18n()
  const score = game.player?.score ?? 0

  return (
    <div className="mx-auto flex min-h-dvh max-w-160 flex-col px-4 pt-6 pb-8 sm:px-6 sm:pt-12">
      <main className="flex flex-col">
        <div className="rounded-2xl border border-rule bg-sheet px-5 pt-5 pb-6 sm:px-9 sm:pt-7 sm:pb-9">
          <header className="flex items-baseline justify-between gap-4">
            <h1 className="font-semibold text-base tracking-tight">{t.title}</h1>
            <p className="flex items-baseline gap-2.5">
              <span className="text-ink-2 text-sm">{t.score}</span>
              <span
                className="font-display font-semibold text-3xl tabular-nums"
                data-testid="score"
              >
                {f.signed(score)}
              </span>
            </p>
          </header>

          <PriceSection game={game} />
          <StatusArea game={game} />
          <GuessButtons game={game} />
        </div>

        <History history={game.player?.history ?? []} />
      </main>
      <Footer />
    </div>
  )
}
