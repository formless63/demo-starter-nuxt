import { z } from 'zod'
import { markRead, markUnread } from '@repo/nuxt-notifications/server'
export default defineEventHandler(async (event) => {
  const recipient = await requireUser(event)
  const parsed = z.object({ read: z.boolean() }).strict().safeParse(await readBody(event))
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!parsed.success || !id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid notification' })
  const exists = await (parsed.data.read ? markRead : markUnread)(useDb(), recipient.id, id.data)
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'Notification not found' })
  return { success: true }
})
