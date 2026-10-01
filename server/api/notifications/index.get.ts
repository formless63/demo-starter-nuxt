import { z } from 'zod'
import { NotificationError, queryNotifications } from '@repo/nuxt-notifications/server'
export default defineEventHandler(async (event) => {
  const recipient = await requireUser(event)
  const parsed = z.object({ unreadOnly: z.enum(['true', 'false']).optional(), type: z.string().optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().optional() }).strict().safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid notification query' })
  return queryNotifications(useDb(), recipient.id, { ...parsed.data, unreadOnly: parsed.data.unreadOnly === 'true' }).catch((error) => {
    if (error instanceof NotificationError && error.code === 'invalid-input') throw createError({ statusCode: 400, statusMessage: 'Invalid notification query' })
    throw error
  })
})
