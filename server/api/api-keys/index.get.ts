import { toSafeApiKey } from '../../utils/api-keys'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const result = await useServerAuth().api.listApiKeys({
    headers: event.headers,
    query: { limit: 100, sortBy: 'createdAt', sortDirection: 'desc' },
  })
  return result.apiKeys.map(toSafeApiKey)
})
