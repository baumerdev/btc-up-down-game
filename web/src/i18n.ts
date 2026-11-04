// All UI text, in English and German (DECISIONS.md #21). Two typed dictionaries, no library:
// TypeScript checks that German has every key. Components read them via useI18n().
import type { Direction } from 'api/types'
import { createContext, useContext } from 'react'
import type { ClientErrorCode } from './api.ts'

export type Lang = 'en' | 'de'

const en = {
  title: 'BTC up or down',
  score: 'Score',
  pair: 'BTC/USD',
  live: 'Live',
  delayed: 'Delayed',
  paused: 'Paused',
  lastTrade: 'last trade',
  loadingPrice: 'Loading the price…',
  direction: { up: 'Up', down: 'Down' } satisfies Record<Direction, string>,
  entry: 'Entry',
  intro: (seconds: number) =>
    `Will the price be higher or lower in ${seconds} seconds? Pick a direction to start.`,
  receiptNote:
    'Your guess counts from the moment our server receives it, so the locked price can differ slightly from the one shown.',
  placing: 'Placing your guess…',
  locking: (direction: string) => `${direction} placed. Locking the price…`,
  lockingSlow: (direction: string) => `${direction} placed. Still locking the price…`,
  lockingSlower: 'This is taking longer than usual…',
  lockingPastEnd: (seconds: number) =>
    `The ${seconds} seconds are over, but Kraken has not delivered the prices for your guess yet. Your result appears as soon as they arrive. Then you can guess again.`,
  lockingStalled:
    'Kraken has not delivered the price for your guess yet. Your guess is saved and counts from the moment it arrived.',
  locked: (direction: string, price: string) => `${direction} locked at ${price}`,
  secondsLeft: (seconds: number) => `${seconds} s left`,
  checking: 'Time is up. Checking the price…',
  waiting: 'Waiting for the price to change',
  waitingDetail: 'The price at the end matched your entry price. The next different trade decides.',
  won: 'You won',
  lost: 'You lost',
  move: (direction: string, from: string, to: string) => `${direction}: ${from} → ${to}`,
  pausedMessage: 'Updates paused after 5 minutes without activity.',
  resume: 'Resume',
  retry: 'Retry',
  reasonActive: 'One guess at a time. Wait for the result.',
  reasonActiveSeconds: (seconds: number) => `Guess active, ${seconds} s left.`,
  reasonDelayed: 'The price is delayed. Guessing resumes when fresh data arrives.',
  reasonPaused: 'Resume updates to guess.',
  reasonNoPrice: 'Guessing starts once the price has loaded.',
  errors: {
    PRICE_OUTDATED:
      'Your guess arrived too late for the price you saw. Check the current price and guess again.',
    TIMEOUT: 'Your guess did not reach the server in time and was not placed. Please try again.',
    PLAYER_NOT_FOUND: 'Your previous score could not be found. You are starting at 0.',
    NETWORK: 'No connection to the server. Check your connection and retry.',
    RATE_LIMITED: 'Too many requests right now. Please wait a moment and try again.',
    generic: 'Something went wrong on our side. Please retry.',
  } satisfies Partial<Record<ClientErrorCode, string>> & { generic: string },
  historyTitle: 'Your last guesses',
  historyEmpty: 'No guesses yet. Each result appears here with its prices, so you can check it.',
  outcome: { won: 'Won', lost: 'Lost' },
  attribution: 'Price data: Kraken',
  storageNote: 'Your score is kept in this browser only. No cookies, no account.',
  language: 'Language',
  theme: 'Theme',
  themeAuto: 'Match system theme',
  themeLight: 'Light theme',
  themeDark: 'Dark theme',
}

export type Dict = typeof en

const de: Dict = {
  title: 'BTC rauf oder runter',
  score: 'Punkte',
  pair: 'BTC/USD',
  live: 'Live',
  delayed: 'Verzögert',
  paused: 'Pausiert',
  lastTrade: 'letzter Trade',
  loadingPrice: 'Kurs wird geladen…',
  direction: { up: 'Rauf', down: 'Runter' },
  entry: 'Einstieg',
  intro: (seconds) =>
    `Steht der Kurs in ${seconds} Sekunden höher oder tiefer? Wähle eine Richtung, um zu starten.`,
  receiptNote:
    'Dein Tipp zählt ab dem Moment, in dem unser Server ihn erhält. Der festgelegte Kurs kann daher leicht vom angezeigten abweichen.',
  placing: 'Tipp wird abgegeben…',
  locking: (direction) => `${direction} abgegeben. Kurs wird festgelegt…`,
  lockingSlow: (direction) => `${direction} abgegeben. Kurs wird immer noch festgelegt…`,
  lockingSlower: 'Das dauert länger als gewöhnlich…',
  lockingPastEnd: (seconds) =>
    `Die ${seconds} Sekunden sind um, aber Kraken hat die Kurse für deinen Tipp noch nicht geliefert. Dein Ergebnis erscheint, sobald sie da sind. Danach kannst du wieder tippen.`,
  lockingStalled:
    'Kraken hat den Kurs für deinen Tipp noch nicht geliefert. Dein Tipp ist gespeichert und zählt ab dem Moment, in dem er ankam.',
  locked: (direction, price) => `${direction} festgelegt bei ${price}`,
  secondsLeft: (seconds) => `noch ${seconds} s`,
  checking: 'Zeit abgelaufen. Kurs wird geprüft…',
  waiting: 'Warten, bis sich der Kurs ändert',
  waitingDetail:
    'Der Kurs am Ende entsprach deinem Einstiegskurs. Der nächste abweichende Trade entscheidet.',
  won: 'Gewonnen',
  lost: 'Verloren',
  move: (direction, from, to) => `${direction}: ${from} → ${to}`,
  pausedMessage: 'Aktualisierung nach 5 Minuten ohne Aktivität pausiert.',
  resume: 'Fortsetzen',
  retry: 'Erneut versuchen',
  reasonActive: 'Ein Tipp nach dem anderen. Warte auf das Ergebnis.',
  reasonActiveSeconds: (seconds) => `Tipp läuft, noch ${seconds} s.`,
  reasonDelayed: 'Der Kurs ist verzögert. Tippen geht wieder, sobald aktuelle Daten da sind.',
  reasonPaused: 'Setze die Aktualisierung fort, um zu tippen.',
  reasonNoPrice: 'Tippen geht los, sobald der Kurs geladen ist.',
  errors: {
    PRICE_OUTDATED:
      'Dein Tipp kam zu spät für den Kurs, den du gesehen hast. Prüfe den aktuellen Kurs und tippe erneut.',
    TIMEOUT:
      'Dein Tipp hat den Server nicht rechtzeitig erreicht und wurde nicht abgegeben. Bitte versuche es erneut.',
    PLAYER_NOT_FOUND: 'Dein bisheriger Punktestand wurde nicht gefunden. Du startest bei 0.',
    NETWORK: 'Keine Verbindung zum Server. Prüfe deine Verbindung und versuche es erneut.',
    RATE_LIMITED: 'Gerade kommen zu viele Anfragen. Bitte warte kurz und versuche es erneut.',
    generic: 'Bei uns ist etwas schiefgelaufen. Bitte versuche es erneut.',
  },
  historyTitle: 'Deine letzten Tipps',
  historyEmpty:
    'Noch keine Tipps. Jedes Ergebnis erscheint hier mit seinen Kursen, damit du es nachprüfen kannst.',
  outcome: { won: 'Gewonnen', lost: 'Verloren' },
  attribution: 'Kursdaten: Kraken',
  storageNote: 'Dein Punktestand liegt nur in diesem Browser. Keine Cookies, kein Konto.',
  language: 'Sprache',
  theme: 'Design',
  themeAuto: 'Systemeinstellung verwenden',
  themeLight: 'Helles Design',
  themeDark: 'Dunkles Design',
}

export const dictionaries: Record<Lang, Dict> = { en, de }

/** Prices, signed numbers and times in the language's format, via Intl ("$76,987.50" / "76.987,50 $"). */
export function formatters(lang: Lang) {
  const locale = lang === 'de' ? 'de-DE' : 'en-US'
  const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' })
  const signed = new Intl.NumberFormat(locale, { signDisplay: 'exceptZero' })
  const signedUsd = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    signDisplay: 'exceptZero',
  })
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'medium' })
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' })
  return {
    usd: (n: number) => usd.format(n),
    signed: (n: number) => signed.format(n).replace('-', '−'),
    signedUsd: (n: number) => signedUsd.format(n).replace('-', '−'),
    time: (iso: string) => time.format(new Date(iso)),
    dateTime: (iso: string) => dateTime.format(new Date(iso)),
  }
}

/** What useI18n() returns: language, texts (`t`), formatters (`f`) and the language switch. */
export interface I18n {
  lang: Lang
  t: Dict
  f: ReturnType<typeof formatters>
  setLang: (lang: Lang) => void
}

export const I18nContext = createContext<I18n>({
  lang: 'en',
  t: en,
  f: formatters('en'),
  setLang: () => {},
})
export const useI18n = () => useContext(I18nContext)
