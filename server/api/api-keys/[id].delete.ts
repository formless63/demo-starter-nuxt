export default defineEventHandler(async (event) => {
  await requireUser(event)
  const keyId = getRouterParam(event, 'id')
  if (!keyId) throw createError({ statusCode: 400, statusMessage: 'API key ID is required' })

  return useServerAuth().api.deleteApiKey({
    headers: event.headers,
    body: { keyId },
  })
})
