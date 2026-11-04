// End-to-end flows from DECISIONS.md #18, through the real API and DynamoDB Local.
import AxeBuilder from '@axe-core/playwright'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { MAX_GUESS_DELAY_MS, STUB_URL } from '../playwright.config.ts'

/** Controls the Kraken stub (kraken-stub.ts): set the price, take it down, or reset it. */
const setStubMarket = (
  request: APIRequestContext,
  body: { price?: number; down?: boolean; reset?: boolean },
) => request.post(`${STUB_URL}/control`, { data: body })

const guessButton = (page: Page, name: 'Up' | 'Down') =>
  page.getByRole('button', { name, exact: true })
const score = (page: Page) => page.getByTestId('score')
/** The status area's live region, where every message appears (#17). */
const statusArea = (page: Page) => page.getByRole('status')
/** Live / Delayed / Paused next to the price. */
const feedStatus = (page: Page) => page.getByTestId('feed-status')

/** Opens the app and waits until the price from the stub is shown live. */
async function openGame(page: Page, price = '$77,000.00') {
  await page.goto('/')
  await expect(page.getByTestId('price')).toHaveText(price)
  await expect(feedStatus(page)).toHaveText('Live')
}

/** Clicks Up or Down and waits until the entry price is locked. */
async function guessAndLock(page: Page, direction: 'Up' | 'Down', entry = '$77,000.00') {
  await guessButton(page, direction).click()
  await expect(statusArea(page)).toHaveText(`${direction} locked at ${entry}`)
}

let consoleErrors: string[]

test.beforeEach(async ({ page, request }) => {
  await setStubMarket(request, { reset: true })
  consoleErrors = []
  page.on('console', (msg) => {
    // HTTP error statuses (409, 422, 503) are expected in some flows; anything else, such as a CSP
    // violation, is a bug.
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      consoleErrors.push(msg.text())
    }
  })
})

test.afterEach(() => {
  expect(consoleErrors).toEqual([])
})

test('first visit shows score 0 and the price, and creates no player', async ({ page }) => {
  await openGame(page)
  await expect(score(page)).toHaveText('0')
  await expect(guessButton(page, 'Up')).toBeEnabled()
  await expect(page.getByText('No guesses yet.')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('playerId'))).toBeNull()
})

test('a malformed stored player ID starts over as a new player', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('playerId', 'not-a-uuid'))

  await openGame(page)
  await expect(statusArea(page)).toHaveText(/previous score could not be found/)
  await expect(score(page)).toHaveText('0')
  await expect(guessButton(page, 'Up')).toBeEnabled()
  expect(await page.evaluate(() => localStorage.getItem('playerId'))).toBeNull()
})

test('placing a guess locks the buttons and shows the entry price, also after a reload', async ({
  page,
}) => {
  await openGame(page)
  await guessAndLock(page, 'Up')
  await expect(guessButton(page, 'Up')).toBeDisabled()
  await expect(guessButton(page, 'Down')).toBeDisabled()
  await expect(page.getByTestId('guess-reason')).toContainText('Guess active')
  await expect(page.getByTestId('entry')).toContainText('$77,000.00')
  await expect(page.getByTestId('bar-countdown')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('playerId'))).toMatch(/^[0-9a-f-]{36}$/)

  await page.reload()
  await expect(statusArea(page)).toHaveText('Up locked at $77,000.00')
  await expect(guessButton(page, 'Up')).toBeDisabled()
})

test('a guess is resolved after the guess window: +1, then −1', async ({ page, request }) => {
  await openGame(page)
  await guessAndLock(page, 'Up')
  await setStubMarket(request, { price: 77_100 })
  await expect(page.getByTestId('reveal')).toHaveText('+1', { timeout: 10_000 })
  await expect(score(page)).toHaveText('+1')
  await expect(page.getByTestId('history')).toContainText('$77,000.00 → $77,100.00')

  await expect(page.getByTestId('price')).toHaveText('$77,100.00')
  await guessAndLock(page, 'Down', '$77,100.00')
  await setStubMarket(request, { price: 77_250 })
  await expect(page.getByTestId('reveal')).toHaveText('−1', { timeout: 10_000 })
  await expect(score(page)).toHaveText('0')
  await expect(page.getByTestId('history').getByRole('listitem')).toHaveCount(2)
})

test('a guess that does not arrive in time is not placed', async ({ page }) => {
  await openGame(page)
  await page.route('**/api/me/guess', async (route) => {
    await new Promise((r) => setTimeout(r, MAX_GUESS_DELAY_MS + 500))
    // The browser has given up by now; if the request still arrives, the server rejects it.
    await route.continue().catch(() => {})
  })
  await guessButton(page, 'Up').click()
  await expect(statusArea(page)).toHaveText('Placing your guess…')
  await expect(page.getByTestId('bar-busy')).toBeVisible()
  await expect(statusArea(page)).toHaveText(/did not reach the server in time/, { timeout: 10_000 })
  await expect(page.getByTestId('bar-busy')).toBeHidden()
  await expect(guessButton(page, 'Up')).toBeEnabled()
  await expect(score(page)).toHaveText('0')
})

test('polling pauses after 5 minutes without interaction and resumes', async ({ page }) => {
  await page.clock.install()
  await openGame(page)
  await page.clock.fastForward('05:02')
  await expect(feedStatus(page)).toHaveText('Paused')
  await expect(statusArea(page)).toContainText('Updates paused')
  await expect(guessButton(page, 'Up')).toBeDisabled()

  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(feedStatus(page)).toHaveText('Live')
  await expect(guessButton(page, 'Up')).toBeEnabled()
})

test('a guess that cannot be locked explains the wait, also after a reload, and resolves later', async ({
  page,
  request,
}) => {
  await openGame(page)
  await setStubMarket(request, { down: true })
  await guessButton(page, 'Up').click()
  await expect(statusArea(page)).toHaveText('Up placed. Locking the price…')
  // The 3 s test window ends long before the 8, 16 and 24 s steps, so the past-end text follows.
  const pastEnd = /The 3 seconds are over, but Kraken has not delivered the prices/
  await expect(statusArea(page)).toHaveText(pastEnd, { timeout: 10_000 })
  await expect(guessButton(page, 'Up')).toBeDisabled()

  await page.reload()
  await expect(statusArea(page)).toHaveText(pastEnd)

  await setStubMarket(request, { down: false })
  // Resolve locks and decides in one call. The stub price has not moved, so the guess waits (#4).
  await expect(statusArea(page)).toHaveText(/Waiting for the price to change/, { timeout: 10_000 })
})

test('an unavailable price shows Delayed and disables guessing', async ({ page, request }) => {
  await openGame(page)
  await setStubMarket(request, { down: true })
  await expect(feedStatus(page)).toHaveText('Delayed', { timeout: 10_000 })
  await expect(guessButton(page, 'Up')).toBeDisabled()
  await expect(page.getByTestId('guess-reason')).toHaveText(/price is delayed/)

  await setStubMarket(request, { down: false })
  await expect(feedStatus(page)).toHaveText('Live', { timeout: 10_000 })
  await expect(guessButton(page, 'Up')).toBeEnabled()
})

test('the language switch changes the text and number format, and is remembered', async ({
  page,
}) => {
  await openGame(page)
  await page.getByRole('button', { name: 'Deutsch' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('BTC rauf oder runter')
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await expect(page.getByTestId('price')).toHaveText('77.000,00 $')

  await page.reload()
  await expect(page.getByRole('button', { name: 'Rauf', exact: true })).toBeVisible()
})

test('the theme switch offers Auto, Light and Dark, and is remembered', async ({ page }) => {
  const html = page.locator('html')
  await page.emulateMedia({ colorScheme: 'dark' })
  await openGame(page)
  await expect(html).toHaveAttribute('data-theme', 'dark')

  await page.getByRole('button', { name: 'Light theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: 'Light theme' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByRole('button', { name: 'Match system theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html).toHaveAttribute('data-theme', 'light')
})

test('two tabs of one player: only one of two simultaneous guesses is accepted', async ({
  page,
  request,
}) => {
  await openGame(page)
  await guessAndLock(page, 'Up')
  await setStubMarket(request, { price: 77_050 })
  await expect(page.getByTestId('reveal')).toHaveText('+1', { timeout: 10_000 })

  const second = await page.context().newPage()
  await openGame(second, '$77,050.00')
  await Promise.all([guessButton(page, 'Up').click(), guessButton(second, 'Down').click()])

  const texts = async () => [
    await statusArea(page).textContent(),
    await statusArea(second).textContent(),
  ]
  // One guess wins; the other tab shows that same guess with its countdown, not an error.
  await expect
    .poll(async () => (await texts()).filter((t) => t?.includes('locked at')).length)
    .toBe(2)
  expect((await texts()).some((t) => t?.includes('already active'))).toBe(false)
})

test('no accessibility violations in either theme, with history', async ({ page, request }) => {
  await openGame(page)
  await guessAndLock(page, 'Down')
  await setStubMarket(request, { price: 76_900 })
  await expect(page.getByTestId('reveal')).toHaveText('+1', { timeout: 10_000 })

  for (const theme of ['Light theme', 'Dark theme']) {
    await page.getByRole('button', { name: theme }).click()
    // Let the colour transitions finish before measuring contrast.
    await page.waitForTimeout(800)
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(result.violations, theme).toEqual([])
  }
})
