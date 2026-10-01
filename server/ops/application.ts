import { createOpsService, type OpsApplication } from '@repo/nuxt-ops-admin/server'
import { getStorage } from '@repo/nuxt-storage/server'
import { getCache } from '@repo/nuxt-cache/server'
import { inspectOpsJobs } from './jobs'

// Static registry is deliberately owned here; removing an optional capability also
// removes its import and adapter. Nothing runs during module setup/startup/health.
export const opsApplication: OpsApplication = {
  resolveSession: event => useServerAuth().api.getSession({ headers: event.headers }),
  service: createOpsService([
    { id: 'jobs', title: 'Jobs (sample time unknown)', isConfigured: () => Boolean(process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL),
      inspect: () => inspectOpsJobs() },
    { id: 'storage', title: 'Private object storage', isConfigured: () => Boolean(process.env.STORAGE_BUCKET),
      inspect: async () => { await getStorage().checkStorage(); return { status: 'ok' } } },
    { id: 'cache', title: 'Cache connection', isConfigured: () => Boolean(process.env.CACHE_URL),
      inspect: async () => { await getCache().checkCache(); return { status: 'ok' } } },
    { id: 'audit', title: 'Audit capability (history not scanned)', isConfigured: () => true,
      inspect: async () => ({ status: 'degraded', code: 'capability-present' }) },
    { id: 'webhooks', title: 'Webhooks (delivery sample unknown)', isConfigured: () => Boolean(process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL),
      inspect: () => inspectOpsJobs(true) },
    { id: 'observability', title: 'Local server instrumentation', countNames: ['enabled'], isConfigured: () => true,
      inspect: async () => ({ status: 'ok', counts: { enabled: 1 } }) },
  ]),
}
