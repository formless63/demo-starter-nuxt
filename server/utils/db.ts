import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../database/schema'
let client: ReturnType<typeof postgres> | undefined
export function useDb() { const { databaseUrl } = useRuntimeConfig(); if(!databaseUrl) throw createError({statusCode:500,statusMessage:'DATABASE_URL is not configured'}); client ??= postgres(databaseUrl, { max:10, idle_timeout:20 }); return drizzle(client,{schema}) }
