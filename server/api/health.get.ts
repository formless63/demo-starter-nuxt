import { sql } from 'drizzle-orm'
import { getBuildInfo, getObservabilityStatus } from '@repo/nuxt-observability/server'

export default defineEventHandler(async () => {
  await useDb().execute(sql`select 1`)
  return { status: 'ok', timestamp: new Date().toISOString(), build: getBuildInfo(), observability: getObservabilityStatus() }
})
