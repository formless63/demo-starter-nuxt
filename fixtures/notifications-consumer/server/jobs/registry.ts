import { defineJob, defineJobRegistry } from '@repo/nuxt-jobs/server'
import { createNotificationJobs, getNotification } from '@repo/nuxt-notifications/server'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
let client: ReturnType<typeof postgres> | undefined
const notifications = createNotificationJobs({ load: id => getNotification(drizzle(client ??= postgres(process.env.DATABASE_URL!, { idle_timeout: 1 })), id) })
const base = defineJob({ name: 'fixture.echo', payload: z.object({ value: z.string() }), handler: data => data })
export const jobRegistry = defineJobRegistry(base, notifications.delivery)
