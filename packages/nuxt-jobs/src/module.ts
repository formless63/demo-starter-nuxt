import { resolve } from 'node:path'
import { addServerImports, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'

export interface JobsModuleOptions {
  schema: string
  concurrency: number
  useListenNotify: boolean
  registry: string
}

export default defineNuxtModule<JobsModuleOptions>({
  meta: {
    name: '@repo/nuxt-jobs',
    configKey: 'jobs',
    compatibility: { nuxt: '>=4.0.0 <5.0.0' },
  },
  defaults: {
    schema: 'pgboss',
    concurrency: 4,
    useListenNotify: false,
    registry: 'server/jobs/registry',
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    nuxt.options.alias['#jobs-registry'] = resolve(nuxt.options.rootDir, options.registry)
    nuxt.options.runtimeConfig.jobs = {
      schema: options.schema,
      concurrency: options.concurrency,
      useListenNotify: options.useListenNotify,
    }

    addServerImports([
      { name: 'sendJob', from: resolver.resolve('./runtime/server/nuxt') },
      { name: 'sendJobInTransaction', from: resolver.resolve('./runtime/server/nuxt') },
    ])
    addServerPlugin(resolver.resolve('./runtime/server/plugin'))
  },
})
