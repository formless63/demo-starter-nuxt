import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createRealtimeEvent, defineRealtimeEvents, getRealtime, parseRealtimeEvent, RealtimeError } from '@repo/nuxt-realtime/server'
import type { RealtimeEvent, RealtimeRequest } from '@repo/nuxt-realtime/server'
import { getCache } from '@repo/nuxt-cache/server'
import { useServerAuth } from '../utils/auth'
import { observeRealtimePublish } from '../utils/observed-realtime'

export const realtimeEvents = defineRealtimeEvents({ 'notifications.created': z.object({ notificationId: z.uuid() }).strict() })
export function notificationChannel(recipientId: string) {
  // Channel does not contain a cookie/token; stable user IDs are server-resolved only.
  const channel = `user:${createHash('sha256').update(recipientId).digest('hex')}:notifications`
  if (!/^[a-z][a-z0-9._:/-]{0,127}$/.test(channel)) throw new RealtimeError('unauthorized')
  return channel
}
export async function authorizeApplicationRealtime(request: RealtimeRequest) {
  if (new URL(request.url, 'http://localhost').search) return undefined
  const origin = request.headers.get('origin')
  const expected = useRuntimeConfig().public.appBaseUrl
  if (origin && origin !== expected) return undefined
  const session = await useServerAuth().api.getSession({ headers: request.headers })
  if (!session?.user) return undefined
  return [notificationChannel(session.user.id)]
}

// Cache composition is application-owned. One publish path: either Cache OR local.
// CACHE_URL opts into non-durable cross-process fanout; no silent local fallback.
const fanoutChannel = 'realtime:notifications'
let subscription: Promise<{ unsubscribe: () => Promise<void> }> | undefined
export async function applicationRealtime() {
  const hub = getRealtime()
  if (process.env.CACHE_URL) {
    subscription ??= getCache().subscribe(fanoutChannel, (bytes) => {
      try {
        const parsed = z.object({ channel: z.string(), event: z.unknown() }).strict().parse(JSON.parse(bytes.toString('utf8')))
        hub.publish(parsed.channel, parseRealtimeEvent(parsed.event, realtimeEvents))
      }
      catch { /* Invalid or lost fanout is not replayable. Never log payload/channel. */ }
    })
    try { await subscription }
    catch { subscription = undefined; throw new RealtimeError('unavailable') }
  }
  return hub
}
export async function publishApplicationRealtime(channel: string, event: RealtimeEvent) {
  if (process.env.CACHE_URL) {
    await applicationRealtime()
    await getCache().publish(fanoutChannel, JSON.stringify({ channel, event }))
  }
  else getRealtime().publish(channel, event)
}
export function publishNotificationHint(recipientId: string, notificationId: string) {
  return observeRealtimePublish(() => publishApplicationRealtime(notificationChannel(recipientId), createRealtimeEvent(realtimeEvents, 'notifications.created', { notificationId })))
}
export async function closeApplicationRealtime() {
  const pending = subscription; subscription = undefined
  if (pending) { try { await (await pending).unsubscribe() } catch { /* Safe shutdown. */ } }
}
