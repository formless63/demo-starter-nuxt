import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, asc, eq, sql } from 'drizzle-orm'
import { createTransferRegistry, createTransferService, defineTransfer, TransferError } from '@repo/nuxt-import-export/server'
import { createJobsClient, resolveJobsConfig } from '@repo/nuxt-jobs/server'
import { getStorage } from '@repo/nuxt-storage/server'
import { appendNotification } from '@repo/nuxt-notifications/server'
import { project, user } from '../database/schema'
import { projectInput } from '../utils/project-input'
import { insertProjectInTransaction } from '../services/projects'
let client: ReturnType<typeof postgres> | undefined
function database() {
  if (!process.env.DATABASE_URL) throw new TransferError('configuration')
  client ??= postgres(process.env.DATABASE_URL, { max: 4, idle_timeout: 20 })
  return drizzle(client)
}
export const projectsTransferDefinition = defineTransfer({
  name: 'projects', version: '1', columns: ['name', 'description'], rowSchema: projectInput,
  async authorize(context, tx) {
    if (context.scope.kind !== 'user' || context.scope.id !== context.requesterId) return false
    const [current] = await (tx ?? database()).select({ id: user.id }).from(user).where(eq(user.id, context.requesterId)).limit(1)
    return Boolean(current)
  },
  async importRows(tx, context, rows, signal) {
    for (const row of rows) {
      if (signal.aborted) throw new TransferError('cancelled')
      await insertProjectInTransaction(tx, context.requesterId, row)
    }
  },
  async *exportRows(tx, context, signal) {
    let after: { id: string, createdAt: string } | undefined
    while (true) {
      const rows = await tx.select({ id: project.id, createdAt: sql<string>`to_char(${project.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, name: project.name, description: project.description }).from(project)
        .where(and(eq(project.ownerId, context.requesterId), after ? sql`(${project.createdAt}, ${project.id}) > (${after.createdAt}::timestamptz, ${after.id}::text)` : undefined))
        .orderBy(asc(project.createdAt), asc(project.id)).limit(100)
      for (const row of rows) { if (signal.aborted) throw new TransferError('cancelled'); yield [row.name, row.description] }
      if (rows.length < 100) break
      after = rows.at(-1)!
    }
  },
})
const registry = createTransferRegistry([projectsTransferDefinition])
export const transferService = createTransferService({
  database, storage: getStorage, registry, boss: () => producer.use(),
  async onCompletion(tx, receipt) {
    await appendNotification(tx, { recipientId: receipt.requesterId, type: 'transfers.complete', title: 'Project transfer finished', body: `Transfer ${receipt.status}.`, metadata: { transferId: receipt.id } })
  },
})
const producer = createJobsClient({ 'import-export.run': transferService.runJob }, resolveJobsConfig, () => { /* Safe errors are reported by the operation boundary. */ })
export async function closeTransferResources() { await producer.stop(); const active = client; client = undefined; await active?.end() }
