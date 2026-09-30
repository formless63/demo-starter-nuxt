import { defineNitroPlugin } from 'nitropack/runtime'
import { closeEmail } from './index'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', closeEmail)
})
