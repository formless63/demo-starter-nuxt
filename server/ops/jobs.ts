import { createJobsBoss, resolveJobsConfig } from '@repo/nuxt-jobs/server'
import { jobRegistry } from '../jobs/registry'
import { webhookJobs } from '../webhooks/registry'

const names = Object.values(jobRegistry).map(job => job.name)
let reader: Promise<ReturnType<typeof createJobsBoss>> | undefined
let inspection: Promise<Awaited<ReturnType<ReturnType<typeof createJobsBoss>['getQueues']>>> | undefined
async function readQueues() {
  if (!names.length || names.length > 32) throw new Error('Operations unavailable')
  reader ??= (async () => {
    const boss = createJobsBoss({ ...resolveJobsConfig(), useListenNotify: false }, 'reader')
    boss.on('error', () => { /* No raw driver errors in Ops logs. */ })
    try { await boss.start(); return boss }
    catch { await boss.stop({ graceful: false }); reader = undefined; throw new Error('Operations unavailable') }
  })()
  // getQueueStats may refresh/write its stale cache in pg-boss12.35; getQueues
  // performs only bounded registered-name metadata SELECT. No createQueue call.
  return (await reader).getQueues(names)
}
async function sharedQueues() {
  inspection ??= readQueues().finally(() => { inspection = undefined })
  return inspection
}
export async function inspectOpsJobs(webhooksOnly = false) {
  const rows = await sharedQueues()
  const selected = webhooksOnly ? rows.filter(row => row.name === webhookJobs.delivery.name) : rows
  // getQueues does not expose the monitor sample time. Counts are cached and may
  // be initial defaults; omit them rather than label an unknown zero instantaneous.
  return { status: selected.length ? 'degraded' as const : 'unavailable' as const, code: 'sample-unknown' as const }
}
export async function closeOpsJobs() { const current = reader; reader = undefined; await (await current?.catch(() => undefined))?.stop({ graceful: false }) }
