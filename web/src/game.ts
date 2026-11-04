// The client-side game flow (DECISIONS.md #12, Appendix A): which request runs when, what the
// player state is, and what the UI shows. App.tsx only renders what `useGame` returns.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Direction, DisplayPrice, HistoryEntry, PlayerState } from 'api/types'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  ApiError,
  apiRequest,
  type ClientErrorCode,
  readStoredPlayerId,
  serverNow,
  storePlayerId,
} from './api.ts'

/** Price polling, and the retry interval of resolve while a guess is not decided yet (#12). */
const POLL_INTERVAL_MS = 2000
const IDLE_PAUSE_AFTER_MS = 5 * 60_000
/** What counts as interaction for the idle pause (#12). */
const INTERACTION_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'touchstart',
  'wheel',
  'scroll',
] as const

/** The current server time (device clock plus offset), updated every `intervalMs` for countdowns. */
export function useServerNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Whether the tab is visible (Page Visibility), not focused: a second monitor keeps updating (#12). */
function usePageVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener('visibilitychange', onChange)
      return () => document.removeEventListener('visibilitychange', onChange)
    },
    () => document.visibilityState === 'visible',
  )
}

/**
 * The idle pause (#12): `paused` turns true after 5 minutes without interaction, never while a
 * guess is active. Only `resume` (the "Resume" button) ends it.
 */
function useIdlePause(guessActive: boolean) {
  const [paused, setPaused] = useState(false)
  const lastInteraction = useRef(Date.now())
  const guessActiveRef = useRef(guessActive)
  guessActiveRef.current = guessActive

  useEffect(() => {
    // Only records a timestamp, so the events need no throttling.
    const recordInteraction = () => {
      lastInteraction.current = Date.now()
    }
    for (const type of INTERACTION_EVENTS) {
      window.addEventListener(type, recordInteraction, { passive: true, capture: true })
    }

    const id = setInterval(() => {
      // An active guess counts as interaction, so the pause cannot start right after the result.
      if (guessActiveRef.current) {
        recordInteraction()
      } else if (Date.now() - lastInteraction.current > IDLE_PAUSE_AFTER_MS) {
        setPaused(true)
      }
    }, 1000)
    return () => {
      for (const type of INTERACTION_EVENTS) {
        window.removeEventListener(type, recordInteraction, { capture: true })
      }
      clearInterval(id)
    }
  }, [])

  const resume = () => {
    lastInteraction.current = Date.now()
    setPaused(false)
  }

  return { paused, resume }
}

export function useGame() {
  const queryClient = useQueryClient()
  const pageVisible = usePageVisible()
  /** An error or notice for the status area, as a code that i18n.ts translates. */
  const [notice, setNotice] = useState<ClientErrorCode | null>(null)
  /** The guess that was just resolved, for the +1 / −1 reveal. Cleared by the next guess. */
  const [revealedResult, setRevealedResult] = useState<HistoryEntry | null>(null)
  const lastResolveAttempt = useRef(0)

  /** Takes a player state from any player endpoint: stores a new player ID, updates the UI. */
  const applyPlayerState = (state: PlayerState) => {
    if (state.playerId && state.playerId !== readStoredPlayerId()) {
      storePlayerId(state.playerId)
    }
    queryClient.setQueryData(['player'], state)
  }

  /** The stored ID is unknown or invalid: drop it and continue as a new player at 0 (#11). */
  const startOverAsNewPlayer = () => {
    storePlayerId(null)
    setNotice('PLAYER_NOT_FOUND')
  }

  // GET /api/me: on load and when the tab becomes visible again; never polled (Appendix A 1, 6).
  const playerQuery = useQuery({
    queryKey: ['player'],
    queryFn: async () => {
      try {
        return await apiRequest<PlayerState>('/api/me')
      } catch (error) {
        // 404: expired after a year. 400: the stored ID is not a UUID (edited by hand).
        const idLost = error instanceof ApiError && (error.status === 404 || error.status === 400)
        if (!idLost) {
          throw error
        }

        startOverAsNewPlayer()
        return apiRequest<PlayerState>('/api/me')
      }
    },
    refetchOnWindowFocus: true,
  })
  const player = playerQuery.data
  const activeGuess = player?.activeGuess ?? null

  const { paused, resume: endIdlePause } = useIdlePause(activeGuess !== null)

  // GET /api/price every 2 s while the tab is visible and not paused (#12).
  const priceQuery = useQuery({
    queryKey: ['price'],
    queryFn: () => apiRequest<DisplayPrice>('/api/price'),
    enabled: !paused,
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  })

  // Another tab created the player and stored its ID: reload the state with that ID (#9).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'playerId') {
        queryClient.invalidateQueries({ queryKey: ['player'] })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [queryClient])

  // Detects a result: the active guess is gone and the newest history entry is that guess (#11).
  const previousGuess = useRef(activeGuess)
  useEffect(() => {
    const previous = previousGuess.current
    previousGuess.current = activeGuess
    const newest = player?.history[0]
    if (previous && !activeGuess && newest?.createdAt === previous.createdAt) {
      setRevealedResult(newest)
    }
  }, [activeGuess, player])

  // POST /api/me/guess. It aborts after maxGuessDelayMs, because the server would reject it then (#22).
  const guessMutation = useMutation({
    mutationFn: (direction: Direction) =>
      apiRequest<PlayerState>('/api/me/guess', {
        body: { direction, seenPriceTime: priceQuery.data?.observedAt },
        timeoutMs: player?.maxGuessDelayMs,
      }),
    onMutate: () => {
      setNotice(null)
      setRevealedResult(null)
    },
    onSuccess: (state) => {
      // A *locking* guess is resolved 2 s later, not immediately (see the resolve schedule below).
      lastResolveAttempt.current = Date.now()
      applyPlayerState(state)
    },
    onError: async (error) => {
      const code = error instanceof ApiError ? error.code : 'INTERNAL'
      if (code === 'PLAYER_NOT_FOUND') {
        startOverAsNewPlayer()
        return void playerQuery.refetch()
      }

      if (code === 'PRICE_OUTDATED') {
        void priceQuery.refetch()
      }
      if (code === 'GUESS_ACTIVE') {
        // Another tab won (#7). Showing its guess with the countdown says it all; a notice
        // would cover the countdown and the result.
        void playerQuery.refetch()
        return
      }
      if (code === 'TIMEOUT') {
        // If the guess reached the server after all, show it instead of an error (Appendix A 3f).
        const fresh = await playerQuery.refetch()
        if (fresh.data?.activeGuess) {
          return
        }
      }

      setNotice(code)
    },
  })

  // POST /api/me/guess/resolve: the server locks the entry price or decides the guess (#4).
  const resolveMutation = useMutation({
    mutationFn: () => apiRequest<PlayerState>('/api/me/guess/resolve', { body: {} }),
    onSettled: () => {
      lastResolveAttempt.current = Date.now()
    },
    onSuccess: applyPlayerState,
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'PLAYER_NOT_FOUND') {
        startOverAsNewPlayer()
        void playerQuery.refetch()
      }
    },
  })

  // Resolve schedule (#12): a locking guess at once, an open guess at resolvableAt, and again every
  // 2 s while the answer is unchanged (data incomplete, waiting, Kraken down). Runs again whenever
  // a response changes the active guess or a call ends.
  const callResolve = resolveMutation.mutate
  useEffect(() => {
    if (!activeGuess || !pageVisible || resolveMutation.isPending) {
      return
    }
    const untilWindowEnd =
      activeGuess.state === 'locking' ? 0 : Date.parse(activeGuess.resolvableAt) - serverNow()
    const untilNextRetry = lastResolveAttempt.current + POLL_INTERVAL_MS - Date.now()
    const id = setTimeout(() => callResolve(), Math.max(untilWindowEnd, untilNextRetry, 0))
    return () => clearTimeout(id)
  }, [activeGuess, pageVisible, resolveMutation.isPending, callResolve])

  const now = useServerNow()

  // "Delayed" when the server fetched the display price longer ago than the server would accept
  // for a guess (#12, #22). Compared in server time, so a wrong device clock doesn't matter.
  const maxGuessDelayMs = player?.maxGuessDelayMs ?? 5000
  const priceDelayed =
    priceQuery.data !== undefined && now - Date.parse(priceQuery.data.observedAt) > maxGuessDelayMs

  return {
    serverNow: now,
    player,
    activeGuess,
    displayPrice: priceQuery.data,
    priceDelayed,
    paused,
    notice,
    revealedResult,
    placingGuess: guessMutation.isPending,
    placeGuess: (direction: Direction) => guessMutation.mutate(direction),
    resume: () => {
      endIdlePause()
      // Also renews the clock offset, which may be off after a long pause.
      void playerQuery.refetch()
    },
    retry: () => {
      setNotice(null)
      void playerQuery.refetch()
      void priceQuery.refetch()
    },
    /** The first GET /api/me failed and there is no player state to show. */
    playerLoadFailed: playerQuery.isError && !player,
  }
}

export type Game = ReturnType<typeof useGame>
