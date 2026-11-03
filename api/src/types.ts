// The API's request and response bodies (DECISIONS.md #11). app.ts produces them; the frontend
// imports this file as `api/types`. All times are ISO strings; terms follow GLOSSARY.md.

export type Direction = 'up' | 'down'

/** Lifecycle of an active guess. A resolved guess is no longer active and appears in the history. */
export type GuessState = 'locking' | 'open' | 'waiting'

export type Outcome = 'won' | 'lost'

export interface ActiveGuess {
  /** Derived by app.ts from the stored guess: no entry price → locking, waiting flag → waiting. */
  state: GuessState
  direction: Direction
  /** When the server received the guess. The entry price is the market price at this moment. */
  createdAt: string
  /** Null while locking. */
  entryPrice: number | null
  entryTradeTime: string | null
  /** End of the guess window. The client calls resolve from then on. */
  resolvableAt: string
}

export interface HistoryEntry {
  direction: Direction
  createdAt: string
  entryPrice: number
  decidingPrice: number
  decidingTradeTime: string
  outcome: Outcome
}

export interface PlayerState {
  /** Null until the player is created with their first guess (#9). */
  playerId: string | null
  /** The client derives its clock offset from this (#12). */
  serverTime: string
  score: number
  /** From the API's config, so the frontend never hard-codes 60 s and 5 s (#18). */
  guessWindowMs: number
  maxGuessDelayMs: number
  activeGuess: ActiveGuess | null
  /** Newest first, at most 10 entries. */
  history: HistoryEntry[]
}

/** GET /api/price. The same for every player, cached by CloudFront for 1 s (#8). */
export interface DisplayPrice {
  price: number
  /** When the trade happened on Kraken. */
  tradeTime: string
  /** When our server fetched it. The client shows "Delayed" when this gets too old (#12). */
  observedAt: string
  serverTime: string
}

/** Body of POST /api/me/guess. */
export interface GuessRequest {
  direction: Direction
  /** `observedAt` of the display price the player saw (#22). */
  seenPriceTime: string
}

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'PLAYER_NOT_FOUND'
  | 'GUESS_ACTIVE'
  | 'PRICE_OUTDATED'
  | 'PRICE_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INTERNAL'

/** Every error response; the frontend translates the code (#11, #21). */
export interface ErrorBody {
  error: { code: ErrorCode }
}
