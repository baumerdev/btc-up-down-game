// The player's language and theme choice, remembered in localStorage (DECISIONS.md #17, #21).
// main.tsx uses useLang, Footer.tsx uses both to show and change the choice.
import { useEffect, useState } from 'react'
import type { Lang } from './i18n.ts'

export type ThemeChoice = 'auto' | 'light' | 'dark'

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSetting(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // Storage blocked: the choice lasts for this page view.
  }
}

/** The UI language: the stored choice, otherwise the browser's language (German or English). */
export function useLang() {
  const [lang, setLang] = useState<Lang>(() => {
    const stored = readSetting('lang')
    if (stored === 'en' || stored === 'de') {
      return stored
    }
    return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en'
  })

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const choose = (next: Lang) => {
    writeSetting('lang', next)
    setLang(next)
  }

  return [lang, choose] as const
}

/**
 * Auto, Light or Dark. Sets `data-theme` on <html>, which styles.css uses; in Auto it follows the
 * system setting live. public/theme.js applies the same rule before the first render (no flash).
 */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const stored = readSetting('theme')
    return stored === 'light' || stored === 'dark' ? stored : 'auto'
  })

  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'auto' && system.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()

    if (choice !== 'auto') {
      return
    }
    system.addEventListener('change', apply)
    return () => system.removeEventListener('change', apply)
  }, [choice])

  const choose = (next: ThemeChoice) => {
    writeSetting('theme', next === 'auto' ? null : next)
    setChoice(next)
  }

  return [choice, choose] as const
}
