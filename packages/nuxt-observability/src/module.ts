import { addServerImports, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'

export interface ObservabilityModuleOptions {
  serviceName: string
  logLevel: string
  redactKeys: string[]
}

export default defineNuxtModule<ObservabilityModuleOptions>({
  meta: {
    name: '@repo/nuxt-observability',
    configKey: 'observability',
    compatibility: { nuxt: '>=4.0.0 <5.0.0' },
  },
  defaults: { serviceName: 'nuxt-application', logLevel: 'info', redactKeys: [] },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    // Supported Nitro async context isolates request lookup across awaits; Node/Bun only.
    nuxt.options.nitro.experimental ??= {}
    nuxt.options.nitro.experimental.asyncContext = true
    nuxt.options.runtimeConfig.observability = { ...options }
    // Nitro's default fallback prints raw errors and full URLs. This supported boundary
    // handles only errors escaping routes; API Platform's handled envelopes are untouched.
    nuxt.options.nitro.errorHandler = resolver.resolve('./runtime/server/error-handler')
    addServerPlugin(resolver.resolve('./runtime/server/plugin'))
    addServerImports(['getLogger', 'withLogContext', 'getRequestContext', 'getRequestId',
      'captureException', 'withSpan', 'getTracer', 'getMeter', 'getBuildInfo'].map(name => ({
      name, from: resolver.resolve('./runtime/server/index'),
    })))
  },
})
