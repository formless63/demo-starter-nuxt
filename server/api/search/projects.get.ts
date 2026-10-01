import type { SearchErrorCode } from '@repo/nuxt-search/server'
import { SearchError } from '@repo/nuxt-search/server'
import { searchProjects } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const safeError = (code: SearchErrorCode) => {
    setResponseStatus(event, code === 'invalid-query' ? 400 : 503)
    return { error: true as const, code }
  }
  const query = getQuery(event)
  if (typeof query.q !== 'string' || (query.cursor !== undefined && typeof query.cursor !== 'string') || (query.pageSize !== undefined && (typeof query.pageSize !== 'string' || !/^\d{1,3}$/.test(query.pageSize)))) {
    return safeError('invalid-query')
  }
  try {
    return await searchProjects(useDb(), user.id, { query: query.q, cursor: query.cursor as string | undefined, pageSize: query.pageSize === undefined ? undefined : Number(query.pageSize) })
  }
  catch (error) {
    const code = error instanceof SearchError ? error.code : 'unavailable'
    return safeError(code)
  }
})
