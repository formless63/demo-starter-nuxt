import { addServerImports, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: '@repo/nuxt-webhooks',
    configKey: 'webhooks',
    compatibility: { nuxt: '>=4.0.0 <5.0.0' },
  },
  moduleDependencies: { '@repo/nuxt-jobs': { version: '>=0.1.0 <0.2.0' } },
  setup() {
    const resolver = createResolver(import.meta.url)
    addServerImports(['verifyWebhookRequest', 'createWebhookEvent', 'createWebhookJobs'].map(name => ({
      name, from: resolver.resolve('./runtime/server/index'),
    })))
  },
})
