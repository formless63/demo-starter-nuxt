import { closeOpsStorage } from '../ops/storage'
export default defineNitroPlugin((nitro) => { nitro.hooks.hook('close', closeOpsStorage) })
