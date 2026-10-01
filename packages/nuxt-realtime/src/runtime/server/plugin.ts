import { defineNitroPlugin } from 'nitropack/runtime'
import { closeRealtime } from './hub'
export default defineNitroPlugin((nitro) => { nitro.hooks.hook('close', closeRealtime) })
