import { defineNuxtPlugin } from '#app'

const stages: Array<{ name: string, at: number }> = []
function record(name: string) {
  stages.push({ name, at: Math.round(performance.now()) })
  document.documentElement.dataset.nuxtE2eStages = JSON.stringify(stages.slice(-40))
}
record('diagnostic-module-evaluated')

export default defineNuxtPlugin({
  name: 'e2e-hydration-diagnostics',
  order: -1000,
  setup(nuxtApp) {
    record('diagnostic-plugin-setup')
    nuxtApp.hook('app:created', () => { record('app:created') })
    nuxtApp.hook('app:beforeMount', () => { record('app:beforeMount') })
    nuxtApp.hook('app:mounted', () => { record('app:mounted') })
    nuxtApp.hook('app:suspense:resolve', () => { record('app:suspense:resolve') })
    nuxtApp.hook('page:start', () => { record('page:start') })
    nuxtApp.hook('page:finish', () => { record('page:finish') })
    nuxtApp.hook('app:error', error => { record(`app:error:${error instanceof Error ? error.name : typeof error}`) })
    nuxtApp.hook('vue:error', error => { record(`vue:error:${error instanceof Error ? error.name : typeof error}`) })
  },
})
