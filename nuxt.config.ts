import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxtjs/color-mode', 'shadcn-nuxt'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  typescript: { strict: true, typeCheck: process.env.NUXT_TYPECHECK !== 'false' },
  colorMode: { classSuffix: '', fallback: 'light' },
  shadcn: {
    prefix: '',
    componentDir: './app/components/ui',
  },
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
