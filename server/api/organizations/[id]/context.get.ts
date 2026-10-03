import { OrganizationError, resolveTenantContextTx } from '@repo/nuxt-organizations/server'
import { eq } from 'drizzle-orm'
import { organization } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  try {
    return await useDb().transaction(async (tx) => {
      const context = await resolveTenantContextTx(user, organizationRouteId(event), tx)
      const [details] = await tx.select({ id: organization.id, name: organization.name, slug: organization.slug })
        .from(organization).where(eq(organization.id, context.scope.id)).limit(1)
      if (!details) throw new OrganizationError('not-found')
      return { role: context.role, organization: details }
    })
  }
  catch (error) { throw organizationHttpError(error) }
})
