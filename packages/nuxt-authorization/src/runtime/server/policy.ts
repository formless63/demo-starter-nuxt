import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { PgTransaction, type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { roleAssignment } from './schema'
import { AuthorizationError, safeAuthorizationError, type AuthorizationErrorCode } from './errors'
import { identifier, nextCursor, opaqueId, pagination, scope, type Scope } from './validation'

export type AuthorizationConnection = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'insert' | 'delete' | 'execute'>
export interface AuthorizationDatabase { transaction<T>(operation: (tx: AuthorizationConnection) => Promise<T>): Promise<T> }
export interface AuthorizationContext {
  readonly userId?: string
  readonly scope: Scope
  /** Verified application credential restrictions; never populated from a caller's JSON. */
  readonly credentialGrants?: ReadonlySet<string>
}
export interface AuthorizationRegistry<Resource = unknown> {
  actions: readonly { id: string, resourceRequired?: boolean, predicate?: (context: AuthorizationContext, resource: Resource, tx: AuthorizationConnection) => boolean | Promise<boolean> }[]
  roles: readonly { id: string, actions: readonly string[] }[]
}
export interface AuthorizationOptions {
  resolveTenantMembership?: (context: AuthorizationContext, tx: AuthorizationConnection, forWrite: boolean) => Promise<{ roles: readonly string[] } | null>
  resolveCodeRoles?: (context: AuthorizationContext, tx: AuthorizationConnection) => Promise<readonly string[]>
  managementGuard?: (actor: AuthorizationContext, targetScope: Scope, operation: 'list' | 'grant' | 'revoke', tx: AuthorizationConnection) => Promise<boolean>
  onAssignmentChange?: (tx: AuthorizationConnection, operation: 'grant' | 'revoke', assignment: typeof roleAssignment.$inferSelect) => Promise<void>
}
export interface AuthorizationDecision {
  allowed: boolean
  reason: 'allowed' | 'unauthenticated' | 'unknown-action' | 'no-grant' | 'scope-mismatch' | 'resource-denied' | 'error'
  errorCode?: AuthorizationErrorCode
}
interface AssignmentInput { scope: Scope, userId: string, roleId: string }
async function bounds(tx: AuthorizationConnection) {
  if (!(tx instanceof PgTransaction)) throw new AuthorizationError('invalid-input')
  await tx.execute(sql`SELECT set_config('statement_timeout','5000',true), set_config('lock_timeout','2000',true)`)
}
function checkedContext(context: AuthorizationContext): AuthorizationContext | null {
  if (!context?.userId) return null
  return Object.freeze({ userId: opaqueId(context.userId), scope: scope(context.scope), credentialGrants: context.credentialGrants })
}
/** Eager, local validation. No database connection or role seeding. */
export function defineAuthorization<Resource = unknown>(registry: AuthorizationRegistry<Resource>, options: AuthorizationOptions = {}) {
  if (!registry || !Array.isArray(registry.actions) || registry.actions.length > 256 || !Array.isArray(registry.roles) || registry.roles.length > 64) throw new AuthorizationError('configuration')
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new AuthorizationError('configuration')
  for (const callback of Object.values(options)) if (callback !== undefined && typeof callback !== 'function') throw new AuthorizationError('configuration')
  const actions = new Map<string, AuthorizationRegistry<Resource>['actions'][number]>()
  const roles = new Map<string, ReadonlySet<string>>()
  for (const entry of registry.actions) {
    if (!entry || typeof entry !== 'object' || (entry.resourceRequired !== undefined && typeof entry.resourceRequired !== 'boolean')) throw new AuthorizationError('configuration')
    const id = identifier(entry.id, 128, true)
    if (actions.has(id) || (entry.predicate !== undefined && typeof entry.predicate !== 'function')) throw new AuthorizationError('configuration')
    actions.set(id, Object.freeze({ ...entry }))
  }
  for (const entry of registry.roles) {
    if (!entry || typeof entry !== 'object') throw new AuthorizationError('configuration')
    const id = identifier(entry.id, 64)
    if (roles.has(id) || !Array.isArray(entry.actions) || entry.actions.length > 256) throw new AuthorizationError('configuration')
    const registered = new Set<string>()
    for (const action of entry.actions) {
      if (!actions.has(action) || registered.has(action)) throw new AuthorizationError('configuration')
      registered.add(action)
    }
    roles.set(id, registered)
  }
  const registeredRoles = [...roles.keys()]
  async function authorizeTx(tx: AuthorizationConnection, inputContext: AuthorizationContext, action: string, resource?: Resource, forWrite = false): Promise<AuthorizationDecision> {
    try {
      const context = checkedContext(inputContext)
      if (!context) return { allowed: false, reason: 'unauthenticated' }
      const definition = actions.get(action)
      if (!definition) return { allowed: false, reason: 'unknown-action' }
      if (context.scope.kind === 'user' && context.scope.id !== context.userId) return { allowed: false, reason: 'scope-mismatch' }
      await bounds(tx)
      const providedRoles: string[] = []
      if (context.scope.kind === 'tenant') {
        if (!options.resolveTenantMembership) return { allowed: false, reason: 'scope-mismatch' }
        const membership = await options.resolveTenantMembership(context, tx, forWrite)
        if (!membership) return { allowed: false, reason: 'scope-mismatch' }
        providedRoles.push(...membership.roles)
      }
      if (options.resolveCodeRoles) providedRoles.push(...await options.resolveCodeRoles(context, tx))
      const query = tx.select({ roleId: roleAssignment.roleId }).from(roleAssignment)
        .where(and(eq(roleAssignment.scopeKind, context.scope.kind), eq(roleAssignment.scopeId, context.scope.id), eq(roleAssignment.userId, context.userId!), inArray(roleAssignment.roleId, registeredRoles))).limit(64)
      const assignments = registeredRoles.length ? (forWrite ? await query.for('share') : await query) : []
      const granted = [...providedRoles, ...assignments.map(row => row.roleId)].some(role => roles.get(role)?.has(action))
      if (!granted || (context.credentialGrants !== undefined && !context.credentialGrants.has(action))) return { allowed: false, reason: 'no-grant' }
      if (definition.resourceRequired && (resource === undefined || !definition.predicate)) return { allowed: false, reason: 'resource-denied' }
      if (definition.predicate && (resource === undefined || !await definition.predicate(context, resource, tx))) return { allowed: false, reason: 'resource-denied' }
      return { allowed: true, reason: 'allowed' }
    }
    catch (error) {
      const safe = safeAuthorizationError(error)
      return { allowed: false, reason: 'error', errorCode: safe.code }
    }
  }
  async function authorize(db: AuthorizationDatabase, context: AuthorizationContext, action: string, resource?: Resource): Promise<AuthorizationDecision> {
    try {
      const actor = checkedContext(context)
      if (!actor) return { allowed: false, reason: 'unauthenticated' }
      if (!actions.has(action)) return { allowed: false, reason: 'unknown-action' }
      if (actor.scope.kind === 'user' && actor.scope.id !== actor.userId) return { allowed: false, reason: 'scope-mismatch' }
      return await db.transaction(tx => authorizeTx(tx, actor, action, resource))
    }
    catch (error) { return { allowed: false, reason: 'error', errorCode: safeAuthorizationError(error).code } }
  }
  function requireDecision(decision: AuthorizationDecision) {
    if (decision.allowed) return
    if (decision.reason === 'error') throw new AuthorizationError(decision.errorCode ?? 'unavailable')
    throw new AuthorizationError(decision.reason === 'unauthenticated' ? 'unauthenticated' : 'forbidden')
  }
  async function requirePermissionTx(tx: AuthorizationConnection, context: AuthorizationContext, action: string, resource?: Resource, forWrite = false) { requireDecision(await authorizeTx(tx, context, action, resource, forWrite)) }
  async function requirePermission(db: AuthorizationDatabase, context: AuthorizationContext, action: string, resource?: Resource) { requireDecision(await authorize(db, context, action, resource)) }
  async function can(db: AuthorizationDatabase, context: AuthorizationContext, action: string, resource?: Resource) { return (await authorize(db, context, action, resource)).allowed }
  async function manage(tx: AuthorizationConnection, inputActor: AuthorizationContext, target: Scope, operation: 'list' | 'grant' | 'revoke') {
    const actor = checkedContext(inputActor)
    if (!actor) throw new AuthorizationError('unauthenticated')
    if (actor.scope.kind === 'user' && actor.scope.id !== actor.userId) throw new AuthorizationError('forbidden')
    if (!options.managementGuard) throw new AuthorizationError('forbidden')
    await bounds(tx)
    if (!await options.managementGuard(actor, target, operation, tx)) throw new AuthorizationError('forbidden')
    return actor
  }
  function assignmentInput(input: AssignmentInput, requireRegistered = true) {
    if (!input || Object.keys(input).some(key => !['scope', 'userId', 'roleId'].includes(key))) throw new AuthorizationError('invalid-input')
    const target = scope(input.scope)
    const userId = opaqueId(input.userId)
    if (target.kind === 'user' && target.id !== userId) throw new AuthorizationError('invalid-input')
    if (typeof input.roleId !== 'string' || input.roleId.length > 64 || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(input.roleId) || (requireRegistered && !roles.has(input.roleId))) throw new AuthorizationError('invalid-input')
    return { ...input, scope: target, userId }
  }
  async function grantRoleTx(tx: AuthorizationConnection, actor: AuthorizationContext, raw: AssignmentInput) {
    const input = assignmentInput(raw)
    try {
      await manage(tx, actor, input.scope, 'grant')
      if (input.scope.kind === 'tenant') {
        if (!options.resolveTenantMembership || !await options.resolveTenantMembership({ userId: input.userId, scope: input.scope }, tx, true)) throw new AuthorizationError('forbidden')
      }
      const [created] = await tx.insert(roleAssignment).values({ id: randomUUID(), scopeKind: input.scope.kind, scopeId: input.scope.id, userId: input.userId, roleId: input.roleId }).onConflictDoNothing().returning()
      if (created && options.onAssignmentChange) await options.onAssignmentChange(tx, 'grant', created)
      if (created) return { assignment: created, changed: true }
      const [existing] = await tx.select().from(roleAssignment).where(and(eq(roleAssignment.scopeKind, input.scope.kind), eq(roleAssignment.scopeId, input.scope.id), eq(roleAssignment.userId, input.userId), eq(roleAssignment.roleId, input.roleId))).limit(1)
      if (!existing) throw new AuthorizationError('conflict')
      return { assignment: existing, changed: false }
    }
    catch (error) { throw safeAuthorizationError(error) }
  }
  async function revokeRoleTx(tx: AuthorizationConnection, actor: AuthorizationContext, raw: AssignmentInput) {
    const input = assignmentInput(raw, false)
    try {
      await manage(tx, actor, input.scope, 'revoke')
      const [removed] = await tx.delete(roleAssignment).where(and(eq(roleAssignment.scopeKind, input.scope.kind), eq(roleAssignment.scopeId, input.scope.id), eq(roleAssignment.userId, input.userId), eq(roleAssignment.roleId, input.roleId))).returning()
      if (removed && options.onAssignmentChange) await options.onAssignmentChange(tx, 'revoke', removed)
      return { changed: !!removed }
    }
    catch (error) { throw safeAuthorizationError(error) }
  }
  function managementPreflight(actor: AuthorizationContext) {
    if (!checkedContext(actor)) throw new AuthorizationError('unauthenticated')
    if (!options.managementGuard) throw new AuthorizationError('forbidden')
  }
  async function grantRole(db: AuthorizationDatabase, actor: AuthorizationContext, input: AssignmentInput) {
    assignmentInput(input)
    managementPreflight(actor)
    try { return await db.transaction(tx => grantRoleTx(tx, actor, input)) }
    catch (error) { throw safeAuthorizationError(error) }
  }
  async function revokeRole(db: AuthorizationDatabase, actor: AuthorizationContext, input: AssignmentInput) {
    assignmentInput(input, false)
    managementPreflight(actor)
    try { return await db.transaction(tx => revokeRoleTx(tx, actor, input)) }
    catch (error) { throw safeAuthorizationError(error) }
  }
  async function listAssignments(db: AuthorizationDatabase, actor: AuthorizationContext, targetScope: Scope, input: { limit?: number, cursor?: string, userId?: string } = {}) {
    managementPreflight(actor)
    const target = scope(targetScope)
    const { limit, cursor } = pagination(input)
    const userId = input.userId === undefined ? undefined : opaqueId(input.userId)
    try {
      return await db.transaction(async (tx) => {
        await manage(tx, actor, target, 'list')
        const rows = await tx.select().from(roleAssignment).where(and(eq(roleAssignment.scopeKind, target.kind), eq(roleAssignment.scopeId, target.id), userId === undefined ? undefined : eq(roleAssignment.userId, userId), cursor ? or(lt(roleAssignment.createdAt, cursor.createdAt), and(eq(roleAssignment.createdAt, cursor.createdAt), lt(roleAssignment.id, cursor.id))) : undefined)).orderBy(desc(roleAssignment.createdAt), desc(roleAssignment.id)).limit(limit + 1)
        const items = rows.slice(0, limit)
        return { items, nextCursor: rows.length > limit && items.length ? nextCursor(items.at(-1)!) : null }
      })
    }
    catch (error) { throw safeAuthorizationError(error) }
  }
  return Object.freeze({ can, authorize, authorizeTx, requirePermission, requirePermissionTx, grantRole, grantRoleTx, revokeRole, revokeRoleTx, listAssignments })
}
