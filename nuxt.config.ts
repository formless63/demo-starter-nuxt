import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },
  // Explicitly opt in to synthetic browser-test diagnostics; never ship by default.
  plugins: process.env.NUXT_E2E_DIAGNOSTICS === 'true'
    ? [`${import.meta.dirname}/tests/e2e/fixtures/hydration-diagnostics.client.ts`]
    : [],
  modules: ['@nuxt/eslint', '@nuxtjs/color-mode', 'shadcn-nuxt', '@repo/nuxt-charts-visualization', '@repo/nuxt-jobs', '@repo/nuxt-api', '@repo/nuxt-observability', '@repo/nuxt-storage', '@repo/nuxt-email', '@repo/nuxt-webhooks', '@repo/nuxt-audit-log', '@repo/nuxt-cache', '@repo/nuxt-realtime', '@repo/nuxt-notifications', '@repo/nuxt-search', '@repo/nuxt-ai', '@repo/nuxt-import-export', '@repo/nuxt-ops-admin'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        // Nuxt's excluded runtime imports these diagnostic entries. Discovering
        // them after the first client request invalidates the cold dev bundle.
        'errx', 'nostics', 'nostics/formatters/ansi', 'nostics/reporters/dev',
        '@tabler/icons-vue', '@vueuse/core', 'better-auth/vue', 'better-auth/client/plugins',
        'class-variance-authority', 'clsx', 'reka-ui', 'tailwind-merge', 'vue-sonner', 'zod',
      ],
    },
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
