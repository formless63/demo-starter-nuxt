import { closeObservedStorage } from '../utils/observed-storage'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', closeObservedStorage)
})
