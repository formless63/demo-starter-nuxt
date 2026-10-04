import { applicationPolicy } from '../utils/application-policy'
import { and, desc, eq } from 'drizzle-orm'
import { resolveTenantContextTx, OrganizationError } from '@repo/nuxt-organizations/server'
import { appendAuditEvent } from '@repo/nuxt-audit-log/server'
import { organizationNote } from '../database/schema'
import type { useDb } from '../utils/db'

type Database = ReturnType<typeof useDb>
export function listOrganizationNotes(db: Database, user: { id: string }, organizationId: string) {
  return db.transaction(async (tx) => {
    const context = await resolveTenantContextTx(user, organizationId, tx)
    await applicationPolicy.requirePermissionTx(tx, { userId: user.id, scope: context.scope }, 'organization.notes.read', { organizationId: context.scope.id })
    return tx.select().from(organizationNote).where(eq(organizationNote.organizationId, context.scope.id)).orderBy(desc(organizationNote.createdAt), desc(organizationNote.id)).limit(25)
  })
}
export function createOrganizationNote(db: Database, user: { id: string }, organizationId: string, title: string) {
  return db.transaction(async (tx) => {
    const context = await resolveTenantContextTx(user, organizationId, tx, true)
    await applicationPolicy.requirePermissionTx(tx, { userId: user.id, scope: context.scope }, 'organization.notes.write', { organizationId: context.scope.id }, true)
    const [row] = await tx.insert(organizationNote).values({ id: crypto.randomUUID(), organizationId: context.scope.id, title }).returning()
    await appendAuditEvent(tx, { actorType: 'user', actorId: user.id, action: 'organization.notes.create', subjectType: 'organization-note', subjectId: row!.id, outcome: 'success' })
    return row!
  })
}
export function updateOrganizationNote(db: Database, user: { id: string }, organizationId: string, id: string, title: string) {
  return db.transaction(async (tx) => {
    const context = await resolveTenantContextTx(user, organizationId, tx, true)
    await applicationPolicy.requirePermissionTx(tx, { userId: user.id, scope: context.scope }, 'organization.notes.write', { organizationId: context.scope.id }, true)
    const [row] = await tx.update(organizationNote).set({ title, updatedAt: new Date() }).where(and(eq(organizationNote.organizationId, context.scope.id), eq(organizationNote.id, id))).returning()
    if (!row) throw new OrganizationError('not-found')
    await appendAuditEvent(tx, { actorType: 'user', actorId: user.id, action: 'organization.notes.update', subjectType: 'organization-note', subjectId: row.id, outcome: 'success' })
    return row
  })
}
