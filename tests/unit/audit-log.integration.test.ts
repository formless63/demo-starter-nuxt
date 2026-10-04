import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { auditEvent, project, user } from '../../server/database/schema'
import { createProject, deleteProject, updateProject } from '../../server/services/projects'
import { queryAuditEvents } from '@repo/nuxt-audit-log/server'

const databaseUrl = process.env.DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
suite('root Project transactional audit', () => {
  const client = new pg.Pool({ connectionString: databaseUrl!, max: 2 }).on('error', () => {})
  const db = drizzle(client)
  const ownerId = crypto.randomUUID()
  const otherId = crypto.randomUUID()
  beforeAll(async () => {
    await db.insert(user).values([
      { id: ownerId, name: 'Audit test', email: `${ownerId}@example.test` },
      { id: otherId, name: 'Other', email: `${otherId}@example.test` },
    ])
  })
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, ownerId))
    await db.delete(user).where(eq(user.id, otherId))
    // Disposable test rows only; history has no cascading user/project FK.
    await db.delete(auditEvent).where(eq(auditEvent.actorId, ownerId))
    await db.delete(auditEvent).where(eq(auditEvent.actorId, otherId))
    await client.end()
  })
  it('records stable user IDs on create/update/delete and preserves history after domain deletion', async () => {
    const created = await createProject(db, ownerId, { name: 'Private name', description: 'Private description' })
    expect(created).toBeDefined()
    expect(await updateProject(db, otherId, created!.id, { name: 'Denied', description: null })).toBeUndefined()
    expect(await deleteProject(db, otherId, created!.id)).toBeUndefined()
    await updateProject(db, ownerId, created!.id, { name: 'Updated private name', description: null })
    await deleteProject(db, ownerId, created!.id)
    const events = await queryAuditEvents(db, { subject: { type: 'project', id: created!.id } })
    expect(events.items.map(e => e.action).sort()).toEqual(['projects.create', 'projects.delete', 'projects.update'])
    for (const event of events.items) {
      expect(event.actorType).toBe('user')
      expect(event.actorId).toBe(ownerId)
      expect(event.outcome).toBe('success')
      expect(event.metadata).toEqual({})
      expect(JSON.stringify(event)).not.toContain('Private')
    }
  })
  it('rolls back each domain mutation when audit validation fails', async () => {
    const badActor = { type: 'x'.repeat(33), id: ownerId }
    await expect(createProject(db, ownerId, { name: 'rolled back', description: null }, badActor)).rejects.toThrow('Invalid audit data')
    expect(await db.select().from(project).where(eq(project.ownerId, ownerId))).toHaveLength(0)
    const created = await createProject(db, ownerId, { name: 'original', description: null })
    await expect(updateProject(db, ownerId, created!.id, { name: 'rolled back', description: null }, badActor)).rejects.toThrow()
    await expect(deleteProject(db, ownerId, created!.id, badActor)).rejects.toThrow()
    const [remaining] = await db.select().from(project).where(eq(project.id, created!.id))
    expect(remaining?.name).toBe('original')
    expect((await queryAuditEvents(db, { subject: { type: 'project', id: created!.id } })).items).toHaveLength(1)
  })
  it('records a machine credential record ID without raw credentials or API package coupling', async () => {
    const created = await createProject(db, ownerId, { name: 'Machine write', description: null }, { type: 'machine', id: otherId })
    const events = await queryAuditEvents(db, { subject: { type: 'project', id: created!.id } })
    expect(events.items).toHaveLength(1)
    expect(events.items[0]).toMatchObject({ actorType: 'machine', actorId: otherId, action: 'projects.create', metadata: {} })
  })
})
