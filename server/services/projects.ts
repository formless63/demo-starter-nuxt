import { applicationPolicy, personalPolicyContext } from '../utils/application-policy'
import { searchRows } from '@repo/nuxt-search/server'
import type { SearchInput } from '@repo/nuxt-search/server'
import { appendAuditEvent } from '@repo/nuxt-audit-log/server'
import type { AuditActor } from '@repo/nuxt-audit-log/server'
import { and, desc, eq } from 'drizzle-orm'
import { project } from '../database/schema'
import type { useDb } from '../utils/db'

type Database = ReturnType<typeof useDb>
type ProjectInput = { name: string, description: string | null }
// Public domain fields are stable as internal/generated columns are added.
const projectFields = { id: project.id, name: project.name, description: project.description, ownerId: project.ownerId, createdAt: project.createdAt, updatedAt: project.updatedAt }

export async function listProjects(db: Database, ownerId: string, credentialGrants?: ReadonlySet<string>) {
  await applicationPolicy.requirePermission(db, personalPolicyContext(ownerId, credentialGrants), 'projects.read', { ownerId })
  return db
    .select(projectFields)
    .from(project)
    .where(eq(project.ownerId, ownerId))
    .orderBy(desc(project.updatedAt))
}

export async function getProject(db: Database, ownerId: string, projectId: string) {
  await applicationPolicy.requirePermission(db, personalPolicyContext(ownerId), 'projects.read', { ownerId })
  const [row] = await db
    .select(projectFields)
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId)))
    .limit(1)

  return row
}

export async function createProject(db: Database, ownerId: string, input: ProjectInput, actor: AuditActor = { type: 'user', id: ownerId }, credentialGrants?: ReadonlySet<string>) {
  return db.transaction(async (tx) => {
    await applicationPolicy.requirePermissionTx(tx, personalPolicyContext(ownerId, credentialGrants), 'projects.create', { ownerId }, true)
    const [row] = await tx
      .insert(project)
      .values({ id: crypto.randomUUID(), ownerId, ...input })
      .returning(projectFields)

    if (row) await appendAuditEvent(tx, { actorType: actor.type, actorId: actor.id, action: 'projects.create', subjectType: 'project', subjectId: row.id, outcome: 'success' })
    return row
  })
}

export async function updateProject(
  db: Database,
  ownerId: string,
  projectId: string,
  input: ProjectInput,
  actor: AuditActor = { type: 'user', id: ownerId },
) {
  return db.transaction(async (tx) => {
    await applicationPolicy.requirePermissionTx(tx, personalPolicyContext(ownerId), 'projects.update', { ownerId }, true)
    const [row] = await tx
      .update(project)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId)))
      .returning(projectFields)

    if (row) await appendAuditEvent(tx, { actorType: actor.type, actorId: actor.id, action: 'projects.update', subjectType: 'project', subjectId: row.id, outcome: 'success' })
    return row
  })
}

export async function deleteProject(db: Database, ownerId: string, projectId: string, actor: AuditActor = { type: 'user', id: ownerId }) {
  return db.transaction(async (tx) => {
    await applicationPolicy.requirePermissionTx(tx, personalPolicyContext(ownerId), 'projects.delete', { ownerId }, true)
    const [row] = await tx
      .delete(project)
      .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId)))
      .returning({ id: project.id })

    if (row) await appendAuditEvent(tx, { actorType: actor.type, actorId: actor.id, action: 'projects.delete', subjectType: 'project', subjectId: row.id, outcome: 'success' })
    return row
  })
}

export async function searchProjects(db: Database, ownerId: string, input: SearchInput) {
  await applicationPolicy.requirePermission(db, personalPolicyContext(ownerId), 'projects.read', { ownerId })
  return searchRows({ vector: project.searchVector, updatedAt: project.updatedAt, id: project.id }, eq(project.ownerId, ownerId), input, plan => db
    .select({ ...projectFields, rank: plan.rank, cursorUpdatedAt: plan.cursorUpdatedAt })
    .from(project)
    .where(plan.where)
    .orderBy(...plan.orderBy)
    .limit(plan.limit))
}
