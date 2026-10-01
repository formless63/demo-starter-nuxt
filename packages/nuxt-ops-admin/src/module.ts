import { createResolver, defineNuxtModule, extendPages, addServerHandler } from '@nuxt/kit'
import { resolve } from 'node:path'

export interface ModuleOptions { application?: string }
export default defineNuxtModule<ModuleOptions>({
  meta: { name: '@repo/nuxt-ops-admin', configKey: 'opsAdmin', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  defaults: {},
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    nuxt.options.nitro.alias ??= {}
    nuxt.options.nitro.alias['#ops-admin-application'] = options.application
      ? resolve(nuxt.options.rootDir, options.application)
      : resolver.resolve('./runtime/server/deny')
    addServerHandler({ route: '/api/ops/summary', method: 'get', handler: resolver.resolve('./runtime/server/summary.get') })
    addServerHandler({ middleware: true, handler: resolver.resolve('./runtime/server/privacy') })
    extendPages(pages => pages.push({ name: 'ops-admin', path: '/admin/ops', file: resolver.resolve('./runtime/pages/OpsOverview.vue') }))
    nuxt.options.routeRules['/admin/ops'] = { prerender: false, cache: false, headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } }
    nuxt.options.routeRules['/api/ops/**'] = { cache: false, headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } }
  },
})
