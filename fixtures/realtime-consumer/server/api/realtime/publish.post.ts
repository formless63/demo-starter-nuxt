import { createRealtimeEvent, getRealtime } from '@repo/nuxt-realtime/server'
import { authorizeFixture, fixtureEvents } from '../../utils/realtime'
export default defineEventHandler(async (event) => {
  const channels = await authorizeFixture({ url: event.path, headers: event.headers })
  if (!channels) throw createError({ statusCode: 401 })
  const value = createRealtimeEvent(fixtureEvents, 'fixture.updated', await readBody(event))
  getRealtime().publish(channels[0]!, value)
  return { id: value.id, active: getRealtime().activeCount }
})
