import { z } from 'zod'
import { NotificationError } from '@repo/nuxt-notifications/server'
import { createApplicationNotification } from '../../notifications/create'
export default defineEventHandler(async (event) => {
  const recipient = await requireUser(event)
  const parsed = z.object({ title: z.string().min(1).max(200), body: z.string(), deliveryChannels: z.array(z.enum(['email', 'ntfy'])).max(2).default([]) }).strict().safeParse(await readBody(event))
  if (!parsed.success || new Set(parsed.data.deliveryChannels).size !== parsed.data.deliveryChannels.length) throw createError({ statusCode: 400, statusMessage: 'Invalid notification' })
  const result = await createApplicationNotification(useDb(), { recipientId: recipient.id, type: 'starter.notification', title: parsed.data.title, body: parsed.data.body }, parsed.data.deliveryChannels).catch((error) => {
    if (error instanceof NotificationError && error.code === 'invalid-input') throw createError({ statusCode: 400, statusMessage: 'Invalid notification' })
    throw error
  })
  setResponseStatus(event, 201)
  return { id: result.id }
})
