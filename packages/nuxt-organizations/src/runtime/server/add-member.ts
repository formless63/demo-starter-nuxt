import { OrganizationError, safeOrganizationError } from './errors'
import { memberRole, opaqueId } from './validation'
import { resolveTenantContext } from './scope'

type Database = Parameters<typeof resolveTenantContext>[2]
interface NativeMemberAuth {
  api: {
    getSession: (input: { headers: Headers }) => Promise<{ user: { id: string } } | null>
    addMember: (input: { headers: Headers, body: { organizationId: string, userId: string, role: 'admin' | 'member' } }) => Promise<unknown>
  }
}
/** Narrow trusted convenience operation, using native dispatch; no raw endpoint proxy or retry. */
export async function addOrganizationMember(auth: NativeMemberAuth, db: Database, actor: { id: string } | null, headers: Headers, input: { organizationId: string, userId: string, role?: 'admin' | 'member' }) {
  if (!actor) throw new OrganizationError('unauthenticated')
  const userId = opaqueId(input.userId)
  const organizationId = opaqueId(input.organizationId)
  const role = memberRole(input.role ?? 'member')
  if (role === 'owner') throw new OrganizationError('forbidden')
  try {
    const authenticated = await auth.api.getSession({ headers })
    if (!authenticated) throw new OrganizationError('unauthenticated')
    if (opaqueId(actor.id) !== authenticated.user.id) throw new OrganizationError('forbidden')
    const context = await resolveTenantContext(authenticated.user, organizationId, db)
    if (context.role !== 'owner' && (context.role !== 'admin' || role !== 'member')) throw new OrganizationError('forbidden')
    // The native beforeAddMember guard rechecks the acting membership at mutation time.
    return await auth.api.addMember({ headers, body: { organizationId, userId, role } })
  }
  catch (error) { throw safeOrganizationError(error) }
}
