import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { project, user } from '../../server/database/schema'
import { deleteProject, getProject, updateProject } from '../../server/services/projects'

const databaseUrl = process.env.DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('project owner authorization', () => {
  const sql = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(sql)
  const suffix = crypto.randomUUID()
  const userA = `user-a-${suffix}`
  const userB = `user-b-${suffix}`
  const projectId = `project-${suffix}`

  beforeAll(async () => {
    await db.insert(user).values([
      { id: userA, name: 'User A', email: `${userA}@example.test` },
      { id: userB, name: 'User B', email: `${userB}@example.test` },
    ])
    await db.insert(project).values({
      id: projectId,
      ownerId: userA,
      name: 'User A project',
      description: 'private',
    })
  })

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userA))
    await db.delete(user).where(eq(user.id, userB))
    await sql.end()
  })

  it('allows the owner to read their project', async () => {
    const result = await getProject(db, userA, projectId)
    expect(result?.name).toBe('User A project')
  })

  it('prevents another user from reading, updating, or deleting the project', async () => {
    expect(await getProject(db, userB, projectId)).toBeUndefined()
    expect(await updateProject(db, userB, projectId, {
      name: 'Stolen',
      description: null,
    })).toBeUndefined()
    expect(await deleteProject(db, userB, projectId)).toBeUndefined()

    const unchanged = await getProject(db, userA, projectId)
    expect(unchanged?.name).toBe('User A project')
  })
})
