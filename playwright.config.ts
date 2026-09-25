import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  webServer: {
    command: 'bun run dev --host 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter',
      NUXT_AUTH_SECRET: process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars',
      NUXT_PUBLIC_APP_BASE_URL: 'http://127.0.0.1:3000',
    },
  },
})
