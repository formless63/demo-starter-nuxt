import { defineConfig } from '@playwright/test'

// Explicit external target verifies the same HTTP contract against the production image.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  // Compose bridge changes can abort unrelated Chromium socket requests. Finish
  // ordinary navigations before this fixture starts or removes infrastructure.
  projects: [
    { name: 'application', testIgnore: '**/import-export.e2e.ts' },
    { name: 'import-export', testMatch: '**/import-export.e2e.ts', dependencies: ['application'] },
  ],
  use: {
    baseURL: externalBaseURL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  webServer: externalBaseURL ? undefined : {
    command: 'bun run dev --host 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    env: {
      NUXT_E2E_DIAGNOSTICS: 'true',
      DEBUG: 'vite:deps,vite:deps-scan',
      DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter',
      NUXT_AUTH_SECRET: process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars',
      NUXT_PUBLIC_APP_BASE_URL: 'http://127.0.0.1:3000',
      REALTIME_TRANSPORTS: 'sse,websocket',
      OPS_ADMIN_USER_IDS: 'ops-e2e-operator',
    },
  },
})
