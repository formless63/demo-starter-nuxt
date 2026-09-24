import { defineConfig } from '@playwright/test'
export default defineConfig({testDir:'tests/e2e',testMatch:'**/*.e2e.ts',use:{baseURL:'http://127.0.0.1:3000'},webServer:{command:'bun run dev',url:'http://127.0.0.1:3000',reuseExistingServer:true,env:{DATABASE_URL:'postgres://postgres:postgres@localhost:5432/nuxt_starter',NUXT_AUTH_SECRET:'e2e-secret-that-is-at-least-thirty-two-chars'}}})
