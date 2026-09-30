import { z } from 'zod'
import { createWebhookJobs, defineWebhookEvents, WebhookError } from '@repo/nuxt-webhooks/server'

export const webhookEvents = defineWebhookEvents({ 'starter.ping': z.object({ message: z.string().min(1).max(200) }).strict() })

// No remote target is configured at boot. Applications own their target registry.
export const webhookJobs = createWebhookJobs({
  events: webhookEvents,
  resolveTarget: () => { throw new WebhookError('invalid-target') },
})
