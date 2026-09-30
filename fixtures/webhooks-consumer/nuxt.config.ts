export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@repo/nuxt-jobs', '@repo/nuxt-webhooks'],
  jobs: { registry: 'server/webhooks/registry' },
  typescript: { strict: true },
  nitro: { preset: 'node-server' },
})
