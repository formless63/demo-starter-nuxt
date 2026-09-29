import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {
  createJobsBoss,
  defineQueues,
  registerWorkers,
  resolveJobsConfig,
  sendRegisteredJobInTransaction,
} from '@repo/nuxt-jobs/server'
import { project, user } from '../../server/database/schema'
import { jobRegistry } from '../../server/jobs/registry'

const databaseUrl = process.env.DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

async function waitForState(
  boss: ReturnType<typeof createJobsBoss>,
  id: string,
  state: 'completed' | 'failed',
) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const job = await boss.getJobById('starter.echo', id)
    if (job?.state === state) return job
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Job ${id} did not reach ${state}`)
}

describeWithDatabase('PostgreSQL jobs integration', () => {
  const client = postgres(databaseUrl!, { max: 2 })
  const db = drizzle(client)
  let boss: ReturnType<typeof createJobsBoss>
  const suffix = crypto.randomUUID()
  const userId = `jobs-user-${suffix}`
  const projectId = `jobs-project-${suffix}`

  beforeAll(async () => {
    boss = createJobsBoss(resolveJobsConfig())
    await boss.start()
    await defineQueues(boss, jobRegistry)
    await db.insert(user).values({ id: userId, name: 'Jobs User', email: `${userId}@example.test` })
    await db.insert(project).values({ id: projectId, ownerId: userId, name: 'Before commit' })
  })

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId))
    await boss.deleteAllJobs('starter.echo')
    await boss.stop({ graceful: false })
    await client.end()
  })

  it('refuses to start against an unmigrated schema because runtime migration is disabled', async () => {
    const schema = `jobs_missing_${suffix.replaceAll('-', '')}`
    const unmigrated = createJobsBoss({ ...resolveJobsConfig(), schema })
    await expect(unmigrated.start()).rejects.toThrow()

    const [{ exists }] = await client<{ exists: boolean }[]>`
      select exists(select 1 from information_schema.schemata where schema_name = ${schema})
    `
    expect(exists).toBe(false)
  })

  it('fails an invalid raw payload at the worker execution boundary', async () => {
    await registerWorkers(boss, jobRegistry, 1)
    const id = await boss.send('starter.echo', { message: '' })
    expect(id).toBeTruthy()
    const failed = await waitForState(boss, id!, 'failed')
    expect(failed.output).toBeTruthy()
    await boss.offWork('starter.echo', { wait: true })
  })

  it('commits an application write and enqueue atomically', async () => {
    let jobId = ''
    await db.transaction(async (tx) => {
      await tx.update(project).set({ name: 'Committed' }).where(eq(project.id, projectId))
      jobId = await sendRegisteredJobInTransaction(
        boss,
        jobRegistry,
        tx,
        'starter.echo',
        { message: 'committed' },
      )
    })

    const [saved] = await db.select({ name: project.name }).from(project).where(eq(project.id, projectId))
    expect(saved?.name).toBe('Committed')
    expect((await boss.getJobById('starter.echo', jobId))?.data).toEqual({ message: 'committed' })
  })

  it('rolls back an application write and enqueue atomically', async () => {
    let jobId = ''
    await expect(db.transaction(async (tx) => {
      await tx.update(project).set({ name: 'Rolled back' }).where(eq(project.id, projectId))
      jobId = await sendRegisteredJobInTransaction(
        boss,
        jobRegistry,
        tx,
        'starter.echo',
        { message: 'rolled back' },
      )
      throw new Error('force rollback')
    })).rejects.toThrow('force rollback')

    const [saved] = await db.select({ name: project.name }).from(project).where(eq(project.id, projectId))
    expect(saved?.name).toBe('Committed')
    expect(await boss.getJobById('starter.echo', jobId)).toBeNull()
  })
})
