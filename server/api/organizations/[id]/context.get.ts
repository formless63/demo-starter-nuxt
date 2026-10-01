import { resolveTenantContext } from '@repo/nuxt-organizations/server'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  try {
    const context = await resolveTenantContext(user, organizationRouteId(event), useDb())
    return { role: context.role }
  }
  catch (error) { throw organizationHttpError(error) }
})
