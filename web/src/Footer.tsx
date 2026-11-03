import { Moon, Sun, SunMoon } from 'lucide-react'
import { type Lang, useI18n } from './i18n.ts'
import { type ThemeChoice, useTheme } from './preferences.ts'

// Footer (#17): price attribution, storage note, language switch (#21) and theme switch.

const LANGS: { lang: Lang; label: string }[] = [
  { lang: 'en', label: 'English' },
  { lang: 'de', label: 'Deutsch' },
]

export function Footer() {
  const { t, lang, setLang } = useI18n()
  const [theme, setTheme] = useTheme()
  const themes: { choice: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { choice: 'auto', label: t.themeAuto, Icon: SunMoon },
    { choice: 'light', label: t.themeLight, Icon: Sun },
    { choice: 'dark', label: t.themeDark, Icon: Moon },
  ]

  return (
    <footer className="mt-auto flex flex-col gap-5 px-1 pt-16 text-ink-2 text-xs sm:px-2">
      <div className="flex flex-col gap-1 leading-relaxed">
        <p>{t.attribution}</p>
        <p>{t.storageNote}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <fieldset className="flex gap-1">
          <legend className="sr-only">{t.language}</legend>
          {LANGS.map((l) => (
            <button
              key={l.lang}
              type="button"
              lang={l.lang}
              aria-pressed={lang === l.lang}
              onClick={() => setLang(l.lang)}
              className="toggle h-9 rounded-md px-3 text-sm"
            >
              {l.label}
            </button>
          ))}
        </fieldset>
        <fieldset className="flex gap-1">
          <legend className="sr-only">{t.theme}</legend>
          {themes.map(({ choice, label, Icon }) => (
            <button
              key={choice}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={theme === choice}
              onClick={() => setTheme(choice)}
              className="toggle inline-flex size-9 items-center justify-center rounded-md"
            >
              <Icon aria-hidden="true" size={17} />
            </button>
          ))}
        </fieldset>
      </div>
    </footer>
  )
}
