import { stopJobsBoss } from './nuxt'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', stopJobsBoss)
})
