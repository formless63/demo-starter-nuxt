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

export function listProjects(db: Database, ownerId: string) {
  return db
    .select(projectFields)
    .from(project)
    .where(eq(project.ownerId, ownerId))
    .orderBy(desc(project.updatedAt))
}

export async function getProject(db: Database, ownerId: string, projectId: string) {
  const [row] = await db
    .select(projectFields)
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId)))
    .limit(1)

  return row
}

type ProjectTransaction = import('drizzle-orm/pg-core').PgDatabase<import('drizzle-orm/pg-core').PgQueryResultHKT>
export async function insertProjectInTransaction(tx: Pick<ProjectTransaction, 'insert'>, ownerId: string, input: ProjectInput, actor: AuditActor = { type: 'user', id: ownerId }) {
  const [row] = await tx.insert(project).values({ id: crypto.randomUUID(), ownerId, ...input }).returning(projectFields)
  if (row) await appendAuditEvent(tx, { actorType: actor.type, actorId: actor.id, action: 'projects.create', subjectType: 'project', subjectId: row.id, outcome: 'success' })
  return row
}
export async function createProject(db: Database, ownerId: string, input: ProjectInput, actor: AuditActor = { type: 'user', id: ownerId }) {
  return db.transaction(tx => insertProjectInTransaction(tx, ownerId, input, actor))
}

export async function updateProject(
  db: Database,
  ownerId: string,
  projectId: string,
  input: ProjectInput,
  actor: AuditActor = { type: 'user', id: ownerId },
) {
  return db.transaction(async (tx) => {
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
    const [row] = await tx
      .delete(project)
      .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId)))
      .returning({ id: project.id })

    if (row) await appendAuditEvent(tx, { actorType: actor.type, actorId: actor.id, action: 'projects.delete', subjectType: 'project', subjectId: row.id, outcome: 'success' })
    return row
  })
}

export function searchProjects(db: Database, ownerId: string, input: SearchInput) {
  return searchRows({ vector: project.searchVector, updatedAt: project.updatedAt, id: project.id }, eq(project.ownerId, ownerId), input, plan => db
    .select({ ...projectFields, rank: plan.rank, cursorUpdatedAt: plan.cursorUpdatedAt })
    .from(project)
    .where(plan.where)
    .orderBy(...plan.orderBy)
    .limit(plan.limit))
}
