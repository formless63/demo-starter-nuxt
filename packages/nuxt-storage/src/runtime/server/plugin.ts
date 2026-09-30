import { defineNitroPlugin } from 'nitropack/runtime'
import { closeStorage } from './index'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', closeStorage)
})
