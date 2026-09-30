import { closeObservedCache } from '../utils/observed-cache'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', closeObservedCache)
})
