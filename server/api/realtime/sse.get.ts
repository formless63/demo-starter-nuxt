import { serveRealtimeSse } from '@repo/nuxt-realtime/server'
import { applicationRealtime, authorizeApplicationRealtime } from '../../realtime/application'
export default defineEventHandler(async (event) => {
  const channels = await authorizeApplicationRealtime({ url: event.path, headers: event.headers })
  if (!channels) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  return serveRealtimeSse(event, { hub: await applicationRealtime(), authorize: async () => channels })
})
