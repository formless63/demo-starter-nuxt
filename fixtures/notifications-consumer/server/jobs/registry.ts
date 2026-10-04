import { defineJob, defineJobRegistry } from '@repo/nuxt-jobs/server'
import { createNotificationJobs, getNotification } from '@repo/nuxt-notifications/server'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
let client: pg.Pool | undefined
const pool = () => { const value = new pg.Pool({ connectionString: process.env.DATABASE_URL!, idleTimeoutMillis: 1000 }); value.on('error', () => {}); return value }
const notifications = createNotificationJobs({ load: id => getNotification(drizzle(client ??= pool()), id) })
const base = defineJob({ name: 'fixture.echo', payload: z.object({ value: z.string() }), handler: data => data })
export const jobRegistry = defineJobRegistry(base, notifications.delivery)
