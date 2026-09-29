import { toSafeApiKey } from '../../utils/api-keys'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const keyId = getRouterParam(event, 'id')
  if (!keyId) throw createError({ statusCode: 400, statusMessage: 'API key ID is required' })

  const updated = await useServerAuth().api.updateApiKey({
    body: { keyId, userId: user.id, enabled: false },
  })
  return toSafeApiKey(updated)
})
