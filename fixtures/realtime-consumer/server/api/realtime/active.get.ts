import { getRealtime } from '@repo/nuxt-realtime/server'
export default defineEventHandler(() => ({ active: getRealtime().activeCount }))
