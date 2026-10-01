import { defineJob } from '@repo/nuxt-jobs/server'
import { z } from 'zod'
import { deliverWebhook } from './delivery'
import type { DeliveryOptions } from './delivery'
import { bodyLimit, eventTypeSchema, parseWebhookEvent, webhookIdSchema } from './events'
import type { WebhookEventRegistry } from './events'
import { boundedInteger, WebhookError } from './errors'

/** Compose delivery into the application's existing Jobs registry/worker. */
export function createWebhookJobs<Registry extends WebhookEventRegistry, const Name extends string = 'webhooks.deliver'>(
  options: DeliveryOptions & { events: Registry, name?: Name, maxBytes?: number, retryLimit?: number, retryDelaySeconds?: number },
) {
  const maxBytes = bodyLimit(options.maxBytes)
  const payload = z.object({
    targetRef: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    id: webhookIdSchema,
    type: eventTypeSchema,
    body: z.string().refine(value => Buffer.byteLength(value) <= maxBytes),
  }).strict().superRefine((value, ctx) => {
    try {
      const event = parseWebhookEvent(JSON.parse(value.body), options.events)
      if (event.id !== value.id || event.type !== value.type) throw new WebhookError('invalid-event')
    }
    catch { ctx.addIssue({ code: 'custom', message: 'Invalid webhook envelope' }) }
  })
  const delivery = defineJob({
    name: (options.name ?? 'webhooks.deliver') as Name,
    payload,
    send: {
      retryLimit: boundedInteger(options.retryLimit ?? 5, 0, 20),
      retryDelay: boundedInteger(options.retryDelaySeconds ?? 30, 1, 900),
      retryBackoff: true,
      retryDelayMax: 900,
      expireInSeconds: 60,
      retentionSeconds: 7 * 24 * 3600,
    },
    handler: async (data, context) => {
      try { return await deliverWebhook(data, options, context.signal) }
      catch (error) {
        const safe = error instanceof WebhookError ? error : new WebhookError('network', true)
        if (safe.retryable) throw safe
        // pg-boss retries every thrown handler error. Return a terminal business outcome.
        return { outcome: 'rejected' as const, code: safe.code, status: safe.status }
      }
    },
  })
  return { delivery, prepare: (targetRef: string, event: { id: string, type: string, body: string }) => payload.parse({ targetRef, ...event }) }
}
