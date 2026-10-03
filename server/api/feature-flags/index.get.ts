import { resolveTenantContext, OrganizationError } from '@repo/nuxt-organizations/server'
import { applicationFlags, clientFlagAllowlist } from '../../utils/application-flags'

export default defineEventHandler(async (event) => {
  const session = await useServerAuth().api.getSession({ headers: event.headers })
  if (!session?.user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  setResponseHeader(event, 'cache-control', 'private, no-store')
  let tenantId: string | undefined
  if (session.session.activeOrganizationId) {
    try { tenantId = (await resolveTenantContext(session.user, session.session.activeOrganizationId, useDb())).scope.id }
    catch (error) {
      if (!(error instanceof OrganizationError && error.code === 'not-found')) return { 'beta.dashboard': false }
      // Stale selected tenant is ignored; it never establishes an evaluation target.
    }
  }
  const details = await applicationFlags.evaluateMany(useDb(), clientFlagAllowlist, { userId: session.user.id, tenantId })
  return Object.fromEntries(clientFlagAllowlist.map(key => [key, details[key]?.value === true]))
})
