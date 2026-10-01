import { defineAuthorization, type AuthorizationContext } from '@repo/nuxt-authorization/server'
import { resolveTenantContextTx, OrganizationError } from '@repo/nuxt-organizations/server'

/** Application policy only: native organization administration remains independent. */
export const applicationPolicy = defineAuthorization<{ ownerId?: string, organizationId?: string }>({
  actions: [
    ...['read', 'create', 'update', 'delete'].map(operation => ({ id: `projects.${operation}`, resourceRequired: true, predicate: (context: AuthorizationContext, resource: { ownerId?: string }) => context.scope.kind === 'user' && context.scope.id === context.userId && resource.ownerId === context.userId })),
    ...['read', 'write'].map(operation => ({ id: `organization.notes.${operation}`, resourceRequired: true, predicate: (context: AuthorizationContext, resource: { organizationId?: string }) => context.scope.kind === 'tenant' && resource.organizationId === context.scope.id })),
    { id: 'dashboard.beta.read' },
  ],
  roles: [
    { id: 'personal-owner', actions: ['projects.read', 'projects.create', 'projects.update', 'projects.delete'] },
    { id: 'organization-reader', actions: ['organization.notes.read'] },
    { id: 'organization-editor', actions: ['organization.notes.read', 'organization.notes.write'] },
    { id: 'dashboard-reader', actions: ['dashboard.beta.read'] },
  ],
}, {
  resolveCodeRoles: async context => context.scope.kind === 'user' && context.scope.id === context.userId ? ['personal-owner'] : [],
  resolveTenantMembership: async (context, tx, forWrite) => {
    try {
      const membership = await resolveTenantContextTx({ id: context.userId! }, context.scope.id, tx, forWrite)
      return { roles: [membership.role === 'member' ? 'organization-reader' : 'organization-editor'] }
    }
    catch (error) { if (error instanceof OrganizationError && error.code === 'not-found') return null; throw error }
  },
  // No application HTTP assignment-management surface or automatic grants.
})
export function personalPolicyContext(userId: string, credentialGrants?: ReadonlySet<string>): AuthorizationContext {
  return Object.freeze({ userId, scope: Object.freeze({ kind: 'user' as const, id: userId }), credentialGrants })
}
/** Existing credential write permission restricts the corresponding application mutations. */
export function projectCredentialActions(permissions: Record<string, string[]>): ReadonlySet<string> {
  const actions = new Set<string>()
  if (permissions.projects?.includes('read')) actions.add('projects.read')
  if (permissions.projects?.includes('write')) for (const action of ['projects.create', 'projects.update', 'projects.delete']) actions.add(action)
  return actions
}
