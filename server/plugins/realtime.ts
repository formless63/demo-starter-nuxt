import { closeApplicationRealtime } from '../realtime/application'
export default defineNitroPlugin((nitro) => { nitro.hooks.hook('close', closeApplicationRealtime) })
