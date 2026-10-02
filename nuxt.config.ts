import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },
  // Explicit synthetic test diagnostics are disabled in ordinary builds.
  plugins: process.env.NUXT_E2E_DIAGNOSTICS === 'true'
    ? [`${import.meta.dirname}/tests/e2e/fixtures/hydration-diagnostics.client.ts`]
    : [],
  modules: ['@repo/nuxt-flow-canvas', '@nuxt/eslint', '@nuxtjs/color-mode', 'shadcn-nuxt', '@repo/nuxt-jobs', '@repo/nuxt-api', '@repo/nuxt-observability', '@repo/nuxt-storage', '@repo/nuxt-email', '@repo/nuxt-webhooks', '@repo/nuxt-audit-log', '@repo/nuxt-cache', '@repo/nuxt-realtime', '@repo/nuxt-notifications', '@repo/nuxt-search', '@repo/nuxt-ai', '@repo/nuxt-import-export', '@repo/nuxt-ops-admin', '@repo/nuxt-invoice-ninja', '@repo/nuxt-stripe', '@repo/nuxt-medusa', '@repo/nuxt-data-table', '@repo/nuxt-charts-visualization', '@repo/nuxt-command-system', '@repo/nuxt-markdown-code'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    // Discover shared client dependencies before serving the first route. Lazy
    // discovery otherwise invalidates already served chunks during navigation.
    // Nuxt diagnostics are excluded from its entry scan, so include their
    // runtime imports explicitly to avoid cold-start optimizer invalidation.
    // Enabled Nuxt DevTools imports these two clients lazily; discovering them
    // after serving entry.js invalidates already loaded diagnostic chunks.
    optimizeDeps: { include: ['@vue/devtools-core', '@vue/devtools-kit', 'errx', 'nostics', 'nostics/formatters/ansi', 'nostics/reporters/dev', '@tabler/icons-vue', '@vueuse/core', 'better-auth/vue', 'better-auth/client/plugins', 'class-variance-authority', 'clsx', 'reka-ui', 'tailwind-merge', 'vue-sonner', 'zod'] },
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
