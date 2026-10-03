import { resolveTenantContext, OrganizationError } from '@repo/nuxt-organizations/server'

export default defineEventHandler(async (event) => {
  const session = await useServerAuth().api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const id = session.session.activeOrganizationId
  if (!id) return { active: null }
  try {
    const context = await resolveTenantContext(session.user, id, useDb())
    return { active: { id: context.scope.id, role: context.role } }
  }
  catch (error) {
    if (error instanceof OrganizationError && error.code === 'not-found') return { active: null }
    throw organizationHttpError(error)
  }
})
