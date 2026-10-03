import { defineNuxtConfig } from 'nuxt/config'

// Retain the deployment tombstone after package, module, UI and source removal.
export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  typescript: { strict: true },
  nitro: { preset: 'node-server' },
  routeRules: {
    '/pwa-offline-sw.js': { headers: { 'cache-control': 'no-cache', 'content-type': 'text/javascript; charset=utf-8' } },
  },
})
