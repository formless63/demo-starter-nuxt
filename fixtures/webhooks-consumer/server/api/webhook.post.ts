import { toWebRequest } from 'h3'
import { verifyWebhookRequest } from '@repo/nuxt-webhooks/server'
import { events } from '../webhooks/registry'

export default defineEventHandler(async (event) => {
  try {
    const verified = await verifyWebhookRequest(toWebRequest(event), { events, secrets: [process.env.WEBHOOK_FIXTURE_SECRET ?? ''] })
    // Real apps should atomically claim the ID with this enqueue using handoffWebhook.
    await sendJob('fixture.retained', { message: verified.data.message })
    return { accepted: true }
  }
  catch { throw createError({ statusCode: 400, statusMessage: 'Webhook rejected' }) }
})
