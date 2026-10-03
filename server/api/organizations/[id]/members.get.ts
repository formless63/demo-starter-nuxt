import { listMembers } from '@repo/nuxt-organizations/server'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  try {
    const query = getQuery(event)
    return await listMembers(user, organizationRouteId(event), useDb(), { limit: query.limit === undefined ? undefined : Number(query.limit), cursor: typeof query.cursor === 'string' ? query.cursor : undefined })
  }
  catch (error) { throw organizationHttpError(error) }
})
