import { Buffer } from 'node:buffer'
import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import { PgTransaction, type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { member, organization, invitation } from './schema'
import { OrganizationError, safeOrganizationError } from './errors'
import { memberRole, opaqueId, type OrganizationRole } from './validation'

type Connection = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'execute'>
interface Database { transaction<T>(operation: (tx: Connection) => Promise<T>): Promise<T> }
export interface TenantContext {
  readonly scope: Readonly<{ kind: 'tenant', id: string }>
  readonly userId: string
  readonly membershipId: string
  readonly role: OrganizationRole
}
async function bounds(tx: Connection) {
  await tx.execute(sql`SELECT set_config('statement_timeout','5000',true), set_config('lock_timeout','2000',true)`)
}
/** Caller owns this transaction. A lock serializes domain writes with membership revocation. */
export async function resolveTenantContextTx(authenticatedUser: { id: string } | null, organizationId: string, tx: Connection, lock = false): Promise<TenantContext> {
  if (!authenticatedUser) throw new OrganizationError('unauthenticated')
  if (!(tx instanceof PgTransaction)) throw new OrganizationError('invalid-input')
  const userId = opaqueId(authenticatedUser.id)
  const tenantId = opaqueId(organizationId)
  try {
    await bounds(tx)
    const query = tx.select({ id: member.id, role: member.role }).from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId))).limit(1)
    const rows = lock ? await query.for('update', { of: member }) : await query
    const row = rows[0]
    if (!row) throw new OrganizationError('not-found')
    return Object.freeze({ scope: Object.freeze({ kind: 'tenant' as const, id: tenantId }), userId, membershipId: row.id, role: memberRole(row.role) })
  }
  catch (error) { throw safeOrganizationError(error) }
}
/** Owns exactly one read transaction; active session selection is never authority. */
export async function resolveTenantContext(authenticatedUser: { id: string } | null, organizationId: string, db: Database) {
  try { return await db.transaction(tx => resolveTenantContextTx(authenticatedUser, organizationId, tx)) }
  catch (error) { throw safeOrganizationError(error) }
}
function page(input: { limit?: number, cursor?: string }) {
  const limit = input.limit ?? 25
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new OrganizationError('invalid-input')
  let cursor: { createdAt: Date, id: string } | undefined
  if (input.cursor !== undefined) {
    try {
      if (input.cursor.length > 2048 || !/^[a-zA-Z0-9_-]+$/.test(input.cursor)) throw new Error()
      const tuple: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
      if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== 1 || typeof tuple[1] !== 'string') throw new Error()
      const id = opaqueId(tuple[2])
      const createdAt = new Date(tuple[1])
      if (createdAt.toISOString() !== tuple[1] || Buffer.from(JSON.stringify(tuple)).toString('base64url') !== input.cursor) throw new Error()
      cursor = { createdAt, id }
    }
    catch { throw new OrganizationError('invalid-input') }
  }
  return { limit, cursor }
}
interface CursorPage<T> { items: T[], nextCursor: string | null }
function result<T extends { id: string, createdAt: Date }>(rows: T[], limit: number): CursorPage<T> {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([1, last.createdAt.toISOString(), last.id])).toString('base64url') : null }
}
export async function listOrganizations(authenticatedUser: { id: string } | null, db: Database, input: { limit?: number, cursor?: string } = {}) {
  if (!authenticatedUser) throw new OrganizationError('unauthenticated')
  const userId = opaqueId(authenticatedUser.id)
  const { limit, cursor } = page(input)
  try {
    return await db.transaction(async (tx) => {
      await bounds(tx)
      const rows = await tx.select({ id: organization.id, name: organization.name, slug: organization.slug, createdAt: organization.createdAt })
        .from(organization).innerJoin(member, eq(member.organizationId, organization.id))
        .where(and(eq(member.userId, userId), cursor ? or(lt(organization.createdAt, cursor.createdAt), and(eq(organization.createdAt, cursor.createdAt), lt(organization.id, cursor.id))) : undefined))
        .orderBy(desc(organization.createdAt), desc(organization.id)).limit(limit + 1)
      return result(rows, limit)
    })
  }
  catch (error) { throw safeOrganizationError(error) }
}
export async function listMembers(authenticatedUser: { id: string } | null, organizationId: string, db: Database, input: { limit?: number, cursor?: string } = {}) {
  const { limit, cursor } = page(input)
  try {
    return await db.transaction(async (tx) => {
      const context = await resolveTenantContextTx(authenticatedUser, organizationId, tx)
      const rows = await tx.select({ id: member.id, userId: member.userId, role: member.role, createdAt: member.createdAt }).from(member)
        .where(and(eq(member.organizationId, context.scope.id), cursor ? or(lt(member.createdAt, cursor.createdAt), and(eq(member.createdAt, cursor.createdAt), lt(member.id, cursor.id))) : undefined))
        .orderBy(desc(member.createdAt), desc(member.id)).limit(limit + 1)
      return result(rows, limit)
    })
  }
  catch (error) { throw safeOrganizationError(error) }
}
/** Explicit read-only operator diagnostic. Never logs or returns invitation email/link. */
export async function diagnoseInvitation(
  db: Database,
  id: string,
  guard: (() => Promise<boolean>) | undefined,
  resolveRecipient: (email: string, tx: Connection) => Promise<string | null>,
) {
  opaqueId(id)
  if (!guard || !await guard()) throw new OrganizationError('forbidden')
  try {
    return await db.transaction(async (tx) => {
      await bounds(tx)
      const [row] = await tx.select().from(invitation).where(eq(invitation.id, id)).limit(1)
      if (!row) throw new OrganizationError('not-found')
      const recipient = await resolveRecipient(row.email, tx)
      const members = recipient ? await tx.select({ id: member.id }).from(member).where(and(eq(member.organizationId, row.organizationId), eq(member.userId, opaqueId(recipient)))).limit(1) : []
      return { state: row.status === 'accepted' && !members.length ? 'accepted-without-membership' as const : 'consistent' as const, status: row.status, hasMembership: members.length > 0 }
    })
  }
  catch (error) { throw safeOrganizationError(error) }
}
