import { PgBoss } from 'pg-boss'
import type { JobsRuntimeConfig } from './types'

function parsePositiveInteger(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
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
    concurrency: parsePositiveInteger(process.env.JOBS_CONCURRENCY, defaults.concurrency ?? 5, 'JOBS_CONCURRENCY'),
    useListenNotify: parseBoolean(
      process.env.PGBOSS_USE_LISTEN_NOTIFY,
      defaults.useListenNotify ?? false,
      'PGBOSS_USE_LISTEN_NOTIFY',
    ),
  }
}

export function createJobsBoss(config: JobsRuntimeConfig, migration = false) {
  return new PgBoss({
    connectionString: config.databaseUrl,
    schema: config.schema,
    migrate: migration,
    supervise: !migration,
    schedule: !migration,
    useListenNotify: migration ? false : config.useListenNotify,
  })
}
