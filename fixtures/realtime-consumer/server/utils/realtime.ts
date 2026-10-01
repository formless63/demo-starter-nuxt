import { z } from 'zod'
import { defineRealtimeEvents } from '@repo/nuxt-realtime/server'
import type { RealtimeRequest } from '@repo/nuxt-realtime/server'
export const fixtureEvents = defineRealtimeEvents({ 'fixture.updated': z.object({ value: z.string() }).strict() })
// Minimal fixture-owned session policy; root E2E verifies actual Better Auth cookies.
export async function authorizeFixture(request: RealtimeRequest) {
  const cookie = request.headers.get('cookie') ?? ''
  if (cookie.split(';').some(value => value.trim() === 'fixture_session=alice')) return ['user:alice']
  if (cookie.split(';').some(value => value.trim() === 'fixture_session=bob')) return ['user:bob']
  return undefined
}
