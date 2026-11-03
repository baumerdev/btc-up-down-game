import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { dictionaries, formatters, I18nContext } from './i18n.ts'
import { useLang } from './preferences.ts'
import './styles.css'

// Entry point: provides TanStack Query (requests, game.ts) and the current language (i18n.ts) to App.

const queryClient = new QueryClient()

/** Holds the language, so a switch in the footer re-renders the whole page in that language. */
function Root() {
  const [lang, setLang] = useLang()
  const i18n = useMemo(
    () => ({ lang, t: dictionaries[lang], f: formatters(lang), setLang }),
    [lang, setLang],
  )

  return (
    <I18nContext value={i18n}>
      <App />
    </I18nContext>
  )
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('#root missing')
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
)
