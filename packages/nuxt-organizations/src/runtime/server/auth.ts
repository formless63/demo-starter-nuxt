import { organization } from 'better-auth/plugins'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError, originCheckMiddleware } from 'better-auth/api'
import { getCurrentAdapter, tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'
import type { AuthEndpointContext } from '@better-auth/core/context'
import type { BetterAuthPlugin } from 'better-auth'
import { OrganizationError, safeOrganizationError, type OrganizationErrorCode } from './errors'
import { invitationEmail, memberRole, opaqueId, organizationFields, resolveOrganizationsConfig } from './validation'

const statuses = {
  configuration: 'INTERNAL_SERVER_ERROR', 'invalid-input': 'BAD_REQUEST', unauthenticated: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN', 'not-found': 'NOT_FOUND', conflict: 'CONFLICT', 'limit-exceeded': 'PAYLOAD_TOO_LARGE',
  expired: 'CONFLICT', unsupported: 'UNPROCESSABLE_ENTITY', timeout: 'GATEWAY_TIMEOUT', unavailable: 'SERVICE_UNAVAILABLE', unknown: 'INTERNAL_SERVER_ERROR',
} as const
function fail(code: OrganizationErrorCode): never {
  const error = new OrganizationError(code)
  throw new APIError(statuses[code], error.toJSON())
}
async function session(ctx: AuthEndpointContext) {
  const found = await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0])
  if (!found) fail('unauthenticated')
  return found
}
function endpoint() {
  const ctx = tryGetCurrentAuthEndpointContext()
  if (!ctx) fail('forbidden')
  return ctx
}
async function membership(ctx: AuthEndpointContext, organizationId: unknown) {
  const actor = await session(ctx)
  const adapter = await getCurrentAdapter(ctx.context.adapter)
  const found = await adapter.findOne<{ id: string, role: string, userId: string }>({
    model: 'member', where: [{ field: 'organizationId', value: opaqueId(organizationId) }, { field: 'userId', value: actor.user.id }],
  })
  if (!found) fail('not-found')
  return { ...found, role: memberRole(found.role) }
}
async function invitePolicy(ctx: AuthEndpointContext, organizationId: unknown, role: unknown) {
  const desired = memberRole(role ?? 'member')
  if (desired === 'owner') fail('forbidden')
  const actor = await membership(ctx, organizationId)
  if (actor.role !== 'owner' && (actor.role !== 'admin' || desired !== 'member')) fail('forbidden')
  return desired
}
async function memberPolicy(organizationId: string, targetRole: string, desired?: string) {
  const actor = await membership(endpoint(), organizationId)
  if (memberRole(targetRole) === 'owner' || desired === 'owner') fail('forbidden')
  if (actor.role !== 'owner' && (actor.role !== 'admin' || targetRole !== 'member' || (desired !== undefined && desired !== 'member'))) fail('forbidden')
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-input')
  return value as Record<string, unknown>
}
function allowedFields(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) fail('invalid-input')
}

/** Native plugin and supported dispatch guard. Merge into, never replace, other auth plugins/hooks. */
export function organizationsAuth(env: Record<string, string | undefined> = process.env) {
  const options = resolveOrganizationsConfig(env)
  const native = organization({
    ...options, creatorRole: 'owner', teams: { enabled: false }, dynamicAccessControl: { enabled: false },
    disableOrganizationDeletion: true, requireEmailVerificationOnInvitation: true,
    organizationHooks: {
      async beforeCreateOrganization({ organization: data }) {
        await session(endpoint())
        return { data: organizationFields(data, true) }
      },
      async beforeUpdateOrganization({ organization: data }) { return { data: organizationFields(data, false) } },
      async beforeAddMember({ member: data }) {
        const ctx = endpoint()
        const actor = await session(ctx)
        const role = memberRole(data.role)
        if (role === 'owner') {
          if (ctx.path !== '/organization/create' || data.userId !== actor.user.id) fail('forbidden')
        }
        else await invitePolicy(ctx, data.organizationId, role)
      },
      async beforeCreateInvitation({ invitation: data }) {
        await invitePolicy(endpoint(), data.organizationId, data.role)
        return { data: { email: invitationEmail(data.email) } }
      },
      async beforeAcceptInvitation({ invitation: data, user }) {
        const role = memberRole(data.role)
        if (role === 'owner') fail('forbidden')
        if (Date.now() >= data.expiresAt.getTime()) fail('expired')
        if (!user.emailVerified || invitationEmail(user.email) !== invitationEmail(data.email)) fail('forbidden')
      },
      async beforeUpdateMemberRole({ member: data, newRole }) {
        await memberPolicy(data.organizationId, data.role, memberRole(newRole))
      },
      async beforeRemoveMember({ member: data }) { await memberPolicy(data.organizationId, data.role) },
    },
  })
  const guard: BetterAuthPlugin = {
    id: 'organizations-v1-guard',
    hooks: {
      after: [{
        matcher: ctx => !!ctx.path?.startsWith('/organization/'),
        handler: createAuthMiddleware(async (ctx) => {
          const result = ctx.context.returned
          if (!isAPIError(result)) return
          try {
          const nativeCode = result.body?.code ?? ''
          if (Object.hasOwn(statuses, nativeCode)) fail(nativeCode as OrganizationErrorCode)
          if (nativeCode === 'INVITATION_NOT_FOUND' && ctx.path === '/organization/accept-invitation') fail('conflict')
          if (['ORGANIZATION_ALREADY_EXISTS', 'ORGANIZATION_SLUG_ALREADY_TAKEN', 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', 'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION'].includes(nativeCode)) fail('conflict')
          if (['ORGANIZATION_MEMBERSHIP_LIMIT_REACHED', 'INVITATION_LIMIT_REACHED', 'YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS'].includes(nativeCode)) fail('limit-exceeded')
          if (nativeCode === 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION') fail('unsupported')
          if (nativeCode.startsWith('YOU_ARE_NOT_ALLOWED') || nativeCode.startsWith('YOU_CANNOT_LEAVE')) fail('forbidden')
          if (result.statusCode === 401) fail('unauthenticated')
          if (result.statusCode === 403) fail('forbidden')
          if (['ORGANIZATION_NOT_FOUND', 'MEMBER_NOT_FOUND', 'INVITATION_NOT_FOUND'].includes(nativeCode)) fail('not-found')
          fail(result.statusCode >= 500 ? 'unavailable' : 'invalid-input')
          }
          catch (error) {
            if (ctx.request && isAPIError(error)) {
              const headers = new Headers(ctx.context.responseHeaders)
              headers.set('content-type', 'application/json')
              headers.set('cache-control', 'private, no-store')
              return new Response(JSON.stringify(error.body), { status: error.statusCode, headers })
            }
            throw error
          }
        }),
      }],
      before: [{
        matcher: ctx => !!ctx.path?.startsWith('/organization/'),
        handler: createAuthMiddleware(async (ctx) => {
          try {
            const current = await session(ctx)
            const body = ctx.body === undefined ? {} : object(ctx.body)
            if (ctx.path === '/organization/delete') fail('unsupported')
            const orgId = body.organizationId ?? (current.session as { activeOrganizationId?: string | null }).activeOrganizationId
            if (body.organizationId !== undefined && body.organizationId !== null) opaqueId(body.organizationId)
            if (body.memberId !== undefined) opaqueId(body.memberId)
            if (body.memberIdOrEmail !== undefined) {
              if (typeof body.memberIdOrEmail === 'string' && body.memberIdOrEmail.includes('@')) invitationEmail(body.memberIdOrEmail)
              else opaqueId(body.memberIdOrEmail)
            }
            if (ctx.path === '/organization/create') {
              allowedFields(body, ['name', 'slug', 'keepCurrentActiveOrganization'])
              const { name, slug } = organizationFields({ name: body.name, slug: body.slug }, true)
              ctx.body = { ...body, name, slug }
            }
            if (ctx.path === '/organization/update') {
              allowedFields(body, ['organizationId', 'data'])
              ctx.body = { ...body, data: organizationFields(object(body.data), false) }
            }
            if (ctx.path === '/organization/invite-member') {
              allowedFields(body, ['organizationId', 'email', 'role', 'resend'])
              const role = await invitePolicy(ctx, orgId, body.role)
              if (body.resend === true) {
                const adapter = await getCurrentAdapter(ctx.context.adapter)
                const existing = await adapter.findMany<{ role: string, expiresAt: Date }>({ model: 'invitation', where: [{ field: 'organizationId', value: opaqueId(orgId) }, { field: 'email', value: invitationEmail(body.email) }, { field: 'status', value: 'pending' }], limit: options.invitationLimit })
                for (const pending of existing) if (new Date(pending.expiresAt).getTime() > Date.now()) await invitePolicy(ctx, orgId, pending.role)
              }
              // Resend returns before beforeCreateInvitation; enforce the same policy here.
              ctx.body = { ...body, email: invitationEmail(body.email), role }
            }
            if (ctx.path === '/organization/update-member-role') memberRole(body.role)
            if (ctx.path === '/organization/leave') {
              const actor = await membership(ctx, orgId)
              if (actor.role === 'owner') fail('forbidden')
            }
            if (['/organization/accept-invitation', '/organization/reject-invitation', '/organization/cancel-invitation'].includes(ctx.path ?? '')) {
              const adapter = await getCurrentAdapter(ctx.context.adapter)
              const invite = await adapter.findOne<{ id: string, status: string, role: string, email: string, organizationId: string, expiresAt: Date }>({
                model: 'invitation', where: [{ field: 'id', value: opaqueId(body.invitationId) }],
              })
              if (!invite) fail('not-found')
              const cancel = ctx.path === '/organization/cancel-invitation'
              if (cancel) {
                const actor = await membership(ctx, invite.organizationId)
                if (actor.role !== 'owner' && (actor.role !== 'admin' || invite.role !== 'member')) fail('forbidden')
              }
              else if (!current.user.emailVerified || invitationEmail(current.user.email) !== invitationEmail(invite.email)) fail('forbidden')
              if (ctx.path === '/organization/accept-invitation') {
                if (memberRole(invite.role) === 'owner') fail('forbidden')
                if (Date.now() >= new Date(invite.expiresAt).getTime()) fail('expired')
              }
              const terminal = cancel ? 'canceled' : 'rejected'
              if (ctx.path !== '/organization/accept-invitation' && invite.status === terminal) {
                // An early dispatch response must retain native origin protection too.
                await originCheckMiddleware(ctx)
                return cancel ? invite : { invitation: invite, member: null }
              }
              if (invite.status !== 'pending') fail('conflict')
            }
            if (ctx.path === '/organization/list-members' || ctx.path === '/organization/list') {
              const query = ctx.query ?? {}
              const limit = query.limit === undefined ? 25 : Number(query.limit)
              if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('invalid-input')
              ctx.query = { ...query, limit }
            }
            return { context: { body: ctx.body, query: ctx.query } }
          }
          catch (error) {
            if (error instanceof OrganizationError) fail(error.code)
            if (isAPIError(error)) throw error
            fail('unavailable')
          }
        }),
      }],
    },
  }
  return [native, guard] as const
}

/** Supply directly in betterAuth options; native router captures the original options. */
export const organizationAuthErrorBoundary = Object.freeze({
  onError(error: unknown): never {
    if (isAPIError(error)) {
      const code = error.body?.code
      if (typeof code === 'string' && Object.hasOwn(statuses, code)) fail(code as OrganizationErrorCode)
      if (error.statusCode === 401) fail('unauthenticated')
      if (error.statusCode === 403) fail('forbidden')
      if (error.statusCode === 404) fail('not-found')
      if (error.statusCode < 500) fail('invalid-input')
    }
    fail(safeOrganizationError(error).code)
  },
})
