export default defineNuxtPlugin(nuxt => { nuxt.hook('app:mounted', () => { document.documentElement.dataset.fixtureReady = 'true' }) })
