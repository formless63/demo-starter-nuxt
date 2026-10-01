import { createJobsBoss } from '@repo/nuxt-jobs/server'
const boss = createJobsBoss({ databaseUrl: process.env.DATABASE_URL, schema: 'pgboss', concurrency: 1, useListenNotify: false }, 'worker')
await boss.start()
const [job] = await boss.fetch('import-export.run', { includeMetadata: true, minPriority: 900, maxPriority: 900, ignoreStartAfter: true })
if (!job || job.id !== process.env.TRANSFER_FIXTURE_JOB || job.retryCount !== 5) throw new Error('Final fixture claim did not match')
console.info('claimed-final-attempt')
// Deliberately no handler/catch: the parent SIGKILLs this uniquely created worker.
setInterval(() => {}, 1000)
