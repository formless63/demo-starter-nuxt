import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxtjs/color-mode', 'shadcn-nuxt', '@repo/nuxt-charts-visualization', '@repo/nuxt-jobs', '@repo/nuxt-api', '@repo/nuxt-observability', '@repo/nuxt-storage', '@repo/nuxt-email', '@repo/nuxt-webhooks', '@repo/nuxt-audit-log', '@repo/nuxt-cache', '@repo/nuxt-realtime', '@repo/nuxt-notifications', '@repo/nuxt-search', '@repo/nuxt-ai', '@repo/nuxt-import-export', '@repo/nuxt-ops-admin'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    // Keep the chart entry and its selective runtime imports in the initial
    // dependency scan. Without this, Vite can invalidate the dev client while
    // a cold multi-page E2E run is already requesting Nuxt entry chunks.
    optimizeDeps: { include: ['echarts/core', 'echarts/renderers', 'echarts/components', 'echarts/charts'] },
  },
  typescript: { strict: true, typeCheck: process.env.NUXT_TYPECHECK !== 'false' },
  colorMode: { classSuffix: '', fallback: 'light' },
  shadcn: {
    prefix: '',
    componentDir: './app/components/ui',
  },
  apiPlatform: {
    auth: 'server/utils/auth',
    contracts: 'server/api-platform/contracts',
    title: 'Nuxt Starter API',
    version: '1.0.0',
  },
  opsAdmin: { application: 'server/ops/application' },
  observability: { serviceName: 'nuxt-starter' },
  runtimeConfig: {
    databaseUrl: '',
    authSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    oidcIssuer: '',
    oidcClientId: '',
    oidcClientSecret: '',
    magicLinkEnabled: false,
    public: {
      appBaseUrl: process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000',
      magicLinkEnabled: false,
    },
  },
  nitro: { preset: 'node-server' },
})
