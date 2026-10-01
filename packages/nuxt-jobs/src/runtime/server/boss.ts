import { PgBoss } from 'pg-boss'
import type { JobsRuntimeConfig } from './types'

export function parseJobsConcurrency(value: string | number | undefined = undefined) {
  if (value === undefined || value === '') return 4
  const parsed = Number(value)
  if ((typeof value === 'string' && !/^\d+$/.test(value)) || !Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('JOBS_CONCURRENCY must be a decimal integer from 1 to 100')
  }
  return parsed
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string) {
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

export function resolveJobsConfig(defaults: Partial<Omit<JobsRuntimeConfig, 'databaseUrl'>> = {}): JobsRuntimeConfig {
  const databaseUrl = process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or PGBOSS_DATABASE_URL is required for jobs')
  }

  return {
    databaseUrl,
    schema: process.env.PGBOSS_SCHEMA || defaults.schema || 'pgboss',
    concurrency: parseJobsConcurrency(process.env.JOBS_CONCURRENCY ?? defaults.concurrency),
    useListenNotify: parseBoolean(
      process.env.PGBOSS_USE_LISTEN_NOTIFY,
      defaults.useListenNotify ?? false,
      'PGBOSS_USE_LISTEN_NOTIFY',
    ),
  }
}

export type JobsBossRole = 'producer' | 'reader' | 'worker' | 'migration'
const connections = new WeakMap<PgBoss, string>()

// Boolean migration arguments remain supported for existing consumers.
export function createJobsBoss(config: JobsRuntimeConfig, role: JobsBossRole | boolean = 'producer') {
  const migration = role === 'migration' || role === true
  const worker = role === 'worker'
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: config.schema,
    migrate: migration,
    supervise: worker,
    schedule: worker,
    useListenNotify: migration ? false : config.useListenNotify,
  })
  connections.set(boss, config.databaseUrl)
  return boss
}

function databaseDestination(value: string | undefined) {
  if (!value) throw new Error('Application DATABASE_URL is required for transactional enqueue')
  let url: URL
  try { url = new URL(value) }
  catch { throw new Error('Transactional enqueue requires a PostgreSQL connection URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2
    || ['host', 'hostaddr', 'port', 'dbname', 'database', 'service'].some(key => url.searchParams.has(key))) {
    throw new Error('Transactional enqueue requires an explicit PostgreSQL host, port and database without routing overrides')
  }
  return JSON.stringify([url.hostname.toLowerCase().replace(/\.$/, ''), Number(url.port || 5432), decodeURIComponent(url.pathname.slice(1))])
}

export function assertJobsTransactionDatabase(boss: PgBoss, applicationDatabaseUrl = process.env.DATABASE_URL) {
  const jobsDatabaseUrl = connections.get(boss)
  if (!jobsDatabaseUrl) throw new Error('Transactional enqueue requires a client created by createJobsBoss')
  if (databaseDestination(applicationDatabaseUrl) !== databaseDestination(jobsDatabaseUrl)) {
    throw new Error('Transactional enqueue requires application and Jobs to use the same canonical host, port and database')
  }
}
