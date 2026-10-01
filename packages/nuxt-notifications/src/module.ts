import { defineNuxtModule } from '@nuxt/kit'
export default defineNuxtModule({
  meta: { name: '@repo/nuxt-notifications', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  moduleDependencies: { '@repo/nuxt-jobs': { version: '>=0.1.0 <0.2.0' } },
  setup() { /* Applications own schema inclusion, migrations, routes and delivery targets. */ },
})
