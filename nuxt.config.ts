import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxtjs/color-mode'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  typescript: { strict: true, typeCheck: true },
  colorMode: { classSuffix: '', fallback: 'light' },
  runtimeConfig: {
    databaseUrl: '',
    authSecret: '',
    githubClientId: '',
    githubClientSecret: '',
    oidcIssuer: '',
    oidcClientId: '',
    oidcClientSecret: '',
    magicLinkEnabled: false,
    public: { appBaseUrl: 'http://localhost:3000', magicLinkEnabled: false },
  },
  nitro: { preset: 'node-server' },
})
