import { authorizedChannels, encodeRealtimeEvent, realtimeChannelSchema } from './events'
import type { RealtimeEvent } from './events'
import { RealtimeError } from './errors'

export function createRealtimeHub() {
  const subscriptions = new Set<{ channels: Set<string>, receive: (event: RealtimeEvent) => void, close?: () => void }>()
  let closed = false
  return {
    get activeCount() { return subscriptions.size },
    subscribe(channels: readonly string[], receive: (event: RealtimeEvent) => void, close?: () => void) {
      if (closed) throw new RealtimeError('closed')
      const subscription = { channels: new Set(authorizedChannels(channels)), receive, close }
      subscriptions.add(subscription)
      return () => { subscriptions.delete(subscription) }
    },
    publish(channel: string, event: RealtimeEvent) {
      if (closed) throw new RealtimeError('closed')
      if (!realtimeChannelSchema.safeParse(channel).success) throw new RealtimeError('invalid-input')
      const encoded = encodeRealtimeEvent(event)
      // Own a JSON snapshot; a producer cannot mutate an enqueued event afterward.
      const snapshot = JSON.parse(encoded) as RealtimeEvent
      for (const subscription of subscriptions) {
        if (!subscription.channels.has(channel)) continue
        try { subscription.receive(snapshot) }
        catch { subscriptions.delete(subscription); subscription.close?.() }
      }
    },
    close() {
      if (closed) return
      closed = true
      const active = [...subscriptions]
      subscriptions.clear()
      for (const subscription of active) subscription.close?.()
    },
  }
}
export type RealtimeHub = ReturnType<typeof createRealtimeHub>
let singleton: RealtimeHub | undefined
export function getRealtime() { return singleton ??= createRealtimeHub() }
export function closeRealtime() { singleton?.close(); singleton = undefined }
