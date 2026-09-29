import { sql } from 'drizzle-orm'
import { fromDrizzle } from 'pg-boss'
import type { DrizzleTransactionLike, PgBoss } from 'pg-boss'
import { getJobDefinition } from './registry'
import type { JobName, JobPayload, JobRegistry } from './types'

export async function defineQueues(boss: PgBoss, registry: JobRegistry) {
  await Promise.all(Object.values(registry).map(job => boss.createQueue(job.name, job.queue)))
}

export async function registerWorkers(boss: PgBoss, registry: JobRegistry, concurrency: number) {
  for (const definition of Object.values(registry)) {
    await boss.work(
      definition.name,
      { ...definition.work, localConcurrency: concurrency },
      async ([job]) => {
        if (!job) throw new Error(`Worker received an empty batch for ${definition.name}`)
        const payload = await definition.payload.parseAsync(job.data)
        return definition.handler(payload, { id: job.id, signal: job.signal })
      },
    )
  }
}

export async function sendRegisteredJob<Registry extends JobRegistry, Name extends JobName<Registry>>(
  boss: PgBoss,
  registry: Registry,
  name: Name,
  payload: JobPayload<Registry, Name>,
) {
  const definition = getJobDefinition(registry, name)
  const data = await definition.payload.parseAsync(payload)
  const id = await boss.send(definition.name, data as object, definition.send)
  if (!id) throw new Error(`pg-boss did not create job ${definition.name}`)
  return id
}

export async function sendRegisteredJobInTransaction<
  Registry extends JobRegistry,
  Name extends JobName<Registry>,
>(
  boss: PgBoss,
  registry: Registry,
  transaction: DrizzleTransactionLike,
  name: Name,
  payload: JobPayload<Registry, Name>,
) {
  const definition = getJobDefinition(registry, name)
  const data = await definition.payload.parseAsync(payload)
  const id = await boss.send(definition.name, data as object, {
    ...definition.send,
    db: fromDrizzle(transaction, sql),
  })
  if (!id) throw new Error(`pg-boss did not create transactional job ${definition.name}`)
  return id
}
