// Every request from the browser to our API goes through `apiRequest` (DECISIONS.md #19). Also
// keeps the player ID in localStorage (#9) and the offset between device and server clock (#12).
import type { ErrorBody } from 'api/types'

const PLAYER_ID_STORAGE_KEY = 'playerId'

/** The player ID stored after the first guess, or null for a new player (#9). */
export function readStoredPlayerId(): string | null {
  try {
    return localStorage.getItem(PLAYER_ID_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Stores the player ID, or removes it with null (unknown player, #11). */
export function storePlayerId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(PLAYER_ID_STORAGE_KEY, id)
    } else {
      localStorage.removeItem(PLAYER_ID_STORAGE_KEY)
    }
  } catch {
    // Storage blocked: the player still plays, but only for this page view.
  }
}

/**
 * The API's error codes, plus: the request timed out or never got through (browser), or a rate
 * limit answered without our JSON body (WAF or API Gateway).
 */
export type ClientErrorCode = ErrorBody['error']['code'] | 'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED'

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 for TIMEOUT and NETWORK. */
    readonly status: number,
    readonly code: ClientErrorCode,
  ) {
    super(code)
  }
}

// Server time minus device time. Taken only from /api/me* responses: /api/price may come from
// CloudFront's cache, so its serverTime can be up to 1 s old (#12).
let clockOffset = 0
/** The server's current time, as far as the client knows it. Used for countdowns and "Delayed". */
export const serverNow = () => Date.now() + clockOffset

/**
 * Sends a GET, or a POST with a JSON body if `body` is given. Adds `X-Player-Id` when an ID is
 * stored. Aborts after `timeoutMs` (default 5 s). Throws `ApiError` with the API's error code.
 */
export async function apiRequest<T>(
  path: string,
  options: { body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const isPost = options.body !== undefined
  const headers: Record<string, string> = {}
  const playerId = readStoredPlayerId()
  if (playerId) {
    headers['X-Player-Id'] = playerId
  }
  if (isPost) {
    headers['Content-Type'] = 'application/json'
  }

  let res: Response
  try {
    res = await fetch(path, {
      method: isPost ? 'POST' : 'GET',
      headers,
      body: isPost ? JSON.stringify(options.body) : undefined,
      // Never answered from the browser cache; the player state must always be fresh.
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    })
  } catch (error) {
    throw new ApiError(
      0,
      error instanceof DOMException && error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK',
    )
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // Rate limits (WAF 403, API Gateway 429) answer without our JSON body.
    const fallback = res.status === 403 || res.status === 429 ? 'RATE_LIMITED' : 'INTERNAL'
    throw new ApiError(res.status, (data as ErrorBody | null)?.error?.code ?? fallback)
  }

  if (path.startsWith('/api/me')) {
    clockOffset = Date.parse(data.serverTime) - Date.now()
  }
  return data as T
}
