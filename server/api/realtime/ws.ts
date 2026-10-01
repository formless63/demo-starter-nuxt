import { createRealtimeWebSocketHandler, getRealtime } from '@repo/nuxt-realtime/server'
import { applicationRealtime, authorizeApplicationRealtime } from '../../realtime/application'
export default createRealtimeWebSocketHandler({
  hub: getRealtime(),
  async authorize(request) {
    const channels = await authorizeApplicationRealtime(request)
    if (channels) await applicationRealtime()
    return channels
  },
})
