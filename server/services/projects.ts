import { and, desc, eq } from 'drizzle-orm'
import { project } from '../database/schema'
import type { useDb } from '../utils/db'

type Database = ReturnType<typeof useDb>
type ProjectInput = { name: string, description: string | null }

export function listProjects(db: Database, ownerId: string) {
  return db
    .select()
    .from(project)
    .where(eq(project.ownerId, ownerId))
    .orderBy(desc(project.updatedAt))
}

export async function getProject(db: Database, ownerId: string, projectId: string) {
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId)))
    .limit(1)

  return row
}

export async function createProject(db: Database, ownerId: string, input: ProjectInput) {
  const [row] = await db
    .insert(project)
    .values({ id: crypto.randomUUID(), ownerId, ...input })
    .returning()

  return row
}

export async function updateProject(
  db: Database,
  ownerId: string,
  projectId: string,
  input: ProjectInput,
) {
  const [row] = await db
    .update(project)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId)))
    .returning()

  return row
}

export async function deleteProject(db: Database, ownerId: string, projectId: string) {
  const [row] = await db
    .delete(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId)))
    .returning({ id: project.id })

  return row
}
