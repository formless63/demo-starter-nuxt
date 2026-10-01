import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import pg from 'pg'
import { drizzle as postgresDrizzle } from 'drizzle-orm/postgres-js'
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres'
import { and, eq, sql } from 'drizzle-orm'
import { defineAuthorization, AuthorizationError, type AuthorizationContext, type AuthorizationConnection } from '@repo/nuxt-authorization/server'
import { roleAssignment, fixtureMembership, fixtureRecord, fixtureAudit } from '../server/database/schema.ts'

const url = process.env.AUTHORIZATION_PROBE_DATABASE_URL!
const client = process.env.AUTHORIZATION_PROBE_DRIVER === 'pg' ? new pg.Pool({ connectionString: url, max: 8 }) : postgres(url, { max: 8 })
const db = client instanceof pg.Pool ? nodeDrizzle(client) : postgresDrizzle(client)
const prefix = randomUUID()
const user = `${prefix}-user`, other = `${prefix}-other`, tenant = `${prefix}-tenant`, secondTenant = `${prefix}-second`
const actor: AuthorizationContext = { userId: 'fixture-operator', scope: { kind: 'user', id: 'fixture-operator' } }
const context: AuthorizationContext = { userId: user, scope: { kind: 'user', id: user } }
const tenantContext: AuthorizationContext = { userId: user, scope: { kind: 'tenant', id: tenant } }
const registry = { actions: [{ id: 'records.read', resourceRequired: true, predicate: (ctx: AuthorizationContext, resource: { ownerId: string }) => resource.ownerId === ctx.userId }, { id: 'records.write' }, { id: 'dashboard.read' }], roles: [{ id: 'reader', actions: ['records.read'] }, { id: 'writer', actions: ['records.write'] }, { id: 'dashboard-reader', actions: ['dashboard.read'] }] }
const managementGuard = async (ctx: AuthorizationContext) => ctx.userId === actor.userId
async function membership(ctx: AuthorizationContext, tx: AuthorizationConnection, forWrite: boolean) {
  const query = tx.select().from(fixtureMembership).where(and(eq(fixtureMembership.scopeId, ctx.scope.id), eq(fixtureMembership.userId, ctx.userId!))).limit(1)
  const [row] = forWrite ? await query.for('share') : await query
  return row ? { roles: row.role === 'member' ? [] : [row.role] } : null
}
const policy = defineAuthorization(registry, { managementGuard, resolveTenantMembership: membership, onAssignmentChange: async (tx, operation, assignment) => { if (operation === 'grant') await tx.insert(fixtureAudit).values({ id: randomUUID(), assignmentId: assignment.id }) } })
const input = (roleId: string, scope = context.scope) => ({ scope, userId: user, roleId })
const errorCode = (code: string) => (error: unknown) => error instanceof AuthorizationError && error.code === code && !JSON.stringify(error).includes(url)
try {
  assert.throws(() => defineAuthorization({ ...registry, roles: [{ id: 'reader', actions: ['unknown.action'] }] }), errorCode('configuration'))
  assert.throws(() => defineAuthorization({ ...registry, actions: [...registry.actions, registry.actions[0]!] }), errorCode('configuration'))
  assert.throws(() => defineAuthorization({ ...registry, actions: [{ id: 'missingdot' }] }), errorCode('configuration'))
  assert.equal(await policy.can(db, context, 'dashboard.read'), false)
  assert.equal((await policy.authorize(db, { scope: context.scope }, 'dashboard.read')).reason, 'unauthenticated')
  assert.equal((await policy.authorize(db, context, 'unknown.action')).reason, 'unknown-action')
  assert.equal((await policy.authorize(db, { ...context, scope: { kind: 'user', id: other } }, 'dashboard.read')).reason, 'scope-mismatch')
  const noGuard = defineAuthorization(registry)
  await assert.rejects(noGuard.grantRole(db, actor, input('reader')), errorCode('forbidden'))
  await assert.rejects(policy.grantRole(db, context, input('reader')), errorCode('forbidden'))
  await assert.rejects(policy.grantRole(db, actor, input('unknown')), errorCode('invalid-input'))
  const grants = await Promise.all(Array.from({ length: 8 }, () => policy.grantRole(db, actor, input('reader'))))
  assert.equal(grants.filter(result => result.changed).length, 1)
  assert.equal(new Set(grants.map(result => result.assignment.id)).size, 1)
  assert.equal(await policy.can(db, context, 'records.read', { ownerId: user }), true)
  assert.equal(await policy.can(db, context, 'records.read', { ownerId: other }), false)
  assert.equal(await policy.can(db, context, 'records.read'), false)
  await policy.grantRole(db, actor, input('writer'))
  assert.equal(await policy.can(db, context, 'records.write'), true)
  assert.equal(await policy.can(db, { ...context, credentialGrants: new Set(['records.read']) }, 'records.write'), false)
  assert.equal(await policy.can(db, { ...context, credentialGrants: new Set(['records.read']) }, 'records.read', { ownerId: user }), true)
  assert.equal(await policy.can(db, { userId: other, scope: { kind: 'user', id: other }, credentialGrants: new Set(['records.write']) }, 'records.write'), false)
  await db.insert(roleAssignment).values({ id: randomUUID(), scopeKind: 'user', scopeId: user, userId: user, roleId: 'removed-role' })
  assert.equal(await policy.can(db, context, 'dashboard.read'), false)
  await policy.revokeRole(db, actor, input('removed-role'))
  await assert.rejects(db.transaction(async tx => { const grant = await policy.grantRoleTx(tx, actor, input('dashboard-reader')); assert(grant.changed); throw new Error('fixture rollback') }), /fixture rollback/)
  assert.equal(await policy.can(db, context, 'dashboard.read'), false)
  const [auditCount] = await db.select({ count: sql<number>`count(*)::integer` }).from(fixtureAudit).where(eq(fixtureAudit.assignmentId, grants[0]!.assignment.id))
  assert.equal(auditCount!.count, 1)
  await db.insert(fixtureMembership).values({ id: randomUUID(), scopeId: tenant, userId: user, role: 'member' })
  await policy.grantRole(db, actor, input('writer', tenantContext.scope))
  assert.equal(await policy.can(db, tenantContext, 'records.write'), true)
  assert.equal(await noGuard.can(db, tenantContext, 'records.write'), false)
  assert.equal(await policy.can(db, { ...tenantContext, scope: { kind: 'tenant', id: secondTenant } }, 'records.write'), false)
  await db.delete(fixtureMembership).where(and(eq(fixtureMembership.scopeId, tenant), eq(fixtureMembership.userId, user)))
  assert.equal(await policy.can(db, tenantContext, 'records.write'), false)
  assert.equal((await db.select().from(roleAssignment).where(eq(roleAssignment.scopeId, tenant))).length, 1)
  const page = await policy.listAssignments(db, actor, context.scope, { limit: 1 })
  assert.equal(page.items.length, 1)
  assert(page.nextCursor)
  const next = await policy.listAssignments(db, actor, context.scope, { limit: 1, cursor: page.nextCursor })
  assert.notEqual(page.items[0]!.id, next.items[0]!.id)
  await assert.rejects(policy.listAssignments(db, actor, context.scope, { cursor: `${page.nextCursor}=` }), errorCode('invalid-input'))
  await assert.rejects(policy.listAssignments(db, actor, context.scope, { limit: 101 }), errorCode('invalid-input'))
  // A protected write holds assignment facts until commit. Revoke waits behind it.
  let announce!: () => void, release!: () => void
  const locked = new Promise<void>(resolve => { announce = resolve }), finish = new Promise<void>(resolve => { release = resolve })
  const write = db.transaction(async tx => { await policy.requirePermissionTx(tx, context, 'records.write', undefined, true); announce(); await finish; await tx.insert(fixtureRecord).values({ id: `${prefix}-owned`, scopeKind: 'user', scopeId: user, ownerId: user, value: 'written' }) })
  await locked
  let revoked = false
  const revoke = policy.revokeRole(db, actor, input('writer')).then(result => { revoked = true; return result })
  // Observe the actual PostgreSQL lock wait rather than relying on elapsed sleep.
  let waiting = false
  for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
    const rows = await db.execute(sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%authorization_assignment%'`)
    waiting = ('rows' in rows ? rows.rows : Array.from(rows as Iterable<unknown>)).length > 0
  }
  assert(waiting)
  assert.equal(revoked, false)
  release(); await write; await revoke
  assert.equal(await policy.can(db, context, 'records.write'), false)
  assert.equal((await policy.revokeRole(db, actor, input('writer'))).changed, false)
  await db.insert(fixtureRecord).values({ id: `${prefix}-foreign`, scopeKind: 'user', scopeId: other, ownerId: other, value: 'private' })
  const failureDb = { transaction: async () => { throw Object.assign(new Error('private provider text'), { code: '08006' }) } }
  assert.deepEqual(await policy.authorize(failureDb, context, 'records.read', { ownerId: user }), { allowed: false, reason: 'error', errorCode: 'unavailable' })
  assert.equal(await policy.can(failureDb, context, 'records.read', { ownerId: user }), false)
  await assert.rejects(policy.requirePermission(failureDb, context, 'records.read', { ownerId: user }), errorCode('unavailable'))
  const timeout = defineAuthorization(registry, { resolveCodeRoles: async (_ctx, tx) => { await tx.execute(sql`SET LOCAL statement_timeout='20ms'`); await tx.execute(sql`SELECT pg_sleep(1)`); return ['reader'] } })
  assert.deepEqual(await timeout.authorize(db, context, 'records.read', { ownerId: user }), { allowed: false, reason: 'error', errorCode: 'timeout' })
  const decisions = await Promise.all(Array.from({ length: 20 }, (_, index) => policy.can(db, index % 2 ? context : { userId: other, scope: { kind: 'user', id: other } }, 'records.read', { ownerId: user })))
  assert(decisions.every((value, index) => value === !!(index % 2)))
  console.info('[authorization fixture] registry, exact scopes, role union, credential intersection, rollback, revocation locks, timeout and isolation passed')
}
finally { if (client instanceof pg.Pool) await client.end(); else await client.end() }
