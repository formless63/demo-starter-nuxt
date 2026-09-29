import { desc, eq } from 'drizzle-orm'
import { project } from '../database/schema'
import type { useDb } from '../utils/db'

type Database = ReturnType<typeof useDb>

export function listProjects(db: Database, ownerId: string) {
  return db.select().from(project).where(eq(project.ownerId, ownerId)).orderBy(desc(project.updatedAt))
}

export async function createProject(
  db: Database,
  ownerId: string,
  input: { name: string, description: string | null },
) {
  const [row] = await db.insert(project).values({ id: crypto.randomUUID(), ownerId, ...input }).returning()
  if (!row) throw new Error('Project insert returned no row')
  return row
}
