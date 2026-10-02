export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@repo/nuxt-jobs', '@repo/nuxt-webhooks', '@repo/nuxt-invoice-ninja'],
  typescript: { strict: true }, nitro: { preset: 'node-server' },
})
