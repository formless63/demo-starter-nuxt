import { getRealtime, serveRealtimeSse } from '@repo/nuxt-realtime/server'
import { authorizeFixture } from '../../utils/realtime'
export default defineEventHandler(event => serveRealtimeSse(event, { hub: getRealtime(), authorize: authorizeFixture }))
