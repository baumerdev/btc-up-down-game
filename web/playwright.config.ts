import { defineConfig, devices } from '@playwright/test'

// The full local stack (DECISIONS.md #18): built frontend under the production CSP, API server,
// DynamoDB Local (`npm run db`) and a Kraken stub. Short guess window and delay keep flows fast.
export const STUB_URL = 'http://127.0.0.1:3131'
export const GUESS_WINDOW_MS = 3000
export const MAX_GUESS_DELAY_MS = 3000

export default defineConfig({
  testDir: 'e2e',
  // The tests share the stub's scripted price, so they run one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'en-US',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'tsx e2e/kraken-stub.ts',
      url: `${STUB_URL}/0/public/Trades`,
      reuseExistingServer: false,
    },
    {
      command: 'tsx ../api/src/server.ts',
      url: 'http://127.0.0.1:3130/api/me',
      reuseExistingServer: false,
      env: {
        PORT: '3130',
        KRAKEN_BASE_URL: STUB_URL,
        DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
        TABLE_NAME: 'btc-updown-e2e',
        GUESS_WINDOW_MS: String(GUESS_WINDOW_MS),
        MAX_GUESS_DELAY_MS: String(MAX_GUESS_DELAY_MS),
      },
    },
    {
      command: 'vite build && vite preview',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      env: { API_URL: 'http://127.0.0.1:3130' },
    },
  ],
})
