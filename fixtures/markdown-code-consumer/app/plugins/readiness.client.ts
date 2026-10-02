export default defineNuxtPlugin((app) => { app.hook('app:mounted', () => { document.documentElement.dataset.fixtureReady = 'true' }) })
