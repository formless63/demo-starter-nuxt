import { defineNitroPlugin } from 'nitropack/runtime'
import { closeCache } from './index'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', closeCache)
})
