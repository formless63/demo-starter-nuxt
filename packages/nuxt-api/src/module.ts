import { resolve } from 'node:path'
import { addServerHandler, addServerImports, createResolver, defineNuxtModule, installModule } from '@nuxt/kit'

export interface ApiPlatformModuleOptions {
  auth: string
  contracts: string
  openApiPath: string
  docsPath: string
  title: string
  version: string
  description: string
}

export default defineNuxtModule<ApiPlatformModuleOptions>({
  meta: {
    name: '@wicaso/nuxt-api',
    configKey: 'apiPlatform',
    compatibility: { nuxt: '>=4.0.0 <5.0.0' },
  },
  defaults: {
    auth: 'server/utils/auth',
    contracts: 'server/api-platform/contracts',
    openApiPath: '/api/openapi.json',
    docsPath: '/docs/api',
    title: 'Application API',
    version: '1.0.0',
    description: 'Machine-facing application API',
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    nuxt.options.alias['#api-platform-auth'] = resolve(nuxt.options.rootDir, options.auth)
    nuxt.options.alias['#api-platform-contracts'] = resolve(nuxt.options.rootDir, options.contracts)
    nuxt.options.runtimeConfig.apiPlatform = {
      title: options.title,
      version: options.version,
      description: options.description,
    }

    addServerImports([
      { name: 'defineApiHandler', from: resolver.resolve('./runtime/server/nuxt') },
      { name: 'parseApiResponse', from: resolver.resolve('./runtime/server/nuxt') },
      { name: 'readApiBody', from: resolver.resolve('./runtime/server/nuxt') },
      { name: 'requireApiKey', from: resolver.resolve('./runtime/server/nuxt') },
    ])
    addServerHandler({
      route: options.openApiPath,
      handler: resolver.resolve('./runtime/server/openapi.get'),
    })

    await installModule('@scalar/nuxt', {
      url: options.openApiPath,
      theme: 'nuxt',
      metaData: { title: `${options.title} reference` },
      pathRouting: { basePath: options.docsPath },
    })
  },
})
