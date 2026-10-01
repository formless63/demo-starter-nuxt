import { createRealtimeWebSocketHandler, getRealtime } from '@repo/nuxt-realtime/server'
import { authorizeFixture } from '../../utils/realtime'
export default createRealtimeWebSocketHandler({ hub: getRealtime(), authorize: authorizeFixture })
