import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTransferService, createTransferRegistry, defineTransfer } from '@repo/nuxt-import-export/server'
import { createStorage } from '@repo/nuxt-storage/server'
import { createJobsBoss, registerWorkers } from '@repo/nuxt-jobs/server'
import { transfer } from '@repo/nuxt-import-export/schema'
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node24 fixture required')
const databaseUrl = process.env.DATABASE_URL!
const connection = postgres(databaseUrl, { max: 4 })
const db = drizzle(connection), storage = createStorage()
const boss = createJobsBoss({ databaseUrl, schema: 'pgboss', concurrency: 1, useListenNotify: false }, 'worker')
const service = createTransferService({ database: () => db, storage: () => storage, boss: async () => boss, registry: createTransferRegistry([defineTransfer({
  name: 'projects', version: '1', columns: ['name', 'description'], rowSchema: z.object({ name: z.string(), description: z.string() }),
  async authorize() { return true }, async importRows() {},
  async *exportRows() { yield ['Node24 real worker', 'native Jobs/Storage CSV'] },
})]) })
try {
  await boss.start(); await registerWorkers(boss, { [service.runJob.name]: service.runJob }, 1)
  const deadline = Date.now() + 60000
  let completed = false
  while (Date.now() < deadline) {
    const [row] = await db.select().from(transfer).where(eq(transfer.id, process.env.TRANSFER_FIXTURE_ID!))
    if (row?.status === 'succeeded') { completed = true; break }
    if (row?.status === 'failed') throw new Error(`Safe transfer failure: ${row.errorCode}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (!completed) throw new Error('Node worker did not complete fixture transfer')
  console.info('[import-export] Node24 native Jobs worker and CSV/S3 protocol passed')
}
finally { await boss.stop({ graceful: true }); storage.close(); await connection.end() }
