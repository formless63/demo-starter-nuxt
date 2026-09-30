import { defineJobRegistry } from '@repo/nuxt-jobs/server'
import { createWebhookJobs, defineWebhookEvents, WebhookError } from '@repo/nuxt-webhooks/server'
import { z } from 'zod'
import { retainedJob } from '../jobs/registry'

export const events = defineWebhookEvents({ 'fixture.ping': z.object({ message: z.string().min(1).max(200) }).strict() })
export const webhooks = createWebhookJobs({
  events,
  retryDelaySeconds: 1,
  retryLimit: 2,
  targetPolicy: { allowLocalHttp: true },
  resolveTarget: (targetRef) => {
    // Explicit fixture environment only; not needed for build/startup.
    if (!process.env.WEBHOOK_FIXTURE_URL || !process.env.WEBHOOK_FIXTURE_SECRET) throw new WebhookError('configuration')
    return { url: `${process.env.WEBHOOK_FIXTURE_URL}/${targetRef}`, secret: process.env.WEBHOOK_FIXTURE_SECRET }
  },
})
export const jobRegistry = defineJobRegistry(retainedJob, webhooks.delivery)
