import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { apiPlatformAuth } from '@repo/nuxt-api/server'
import * as schema from '../database/schema'

function createServerAuth() {
  const config = useRuntimeConfig()
  if (!config.authSecret || config.authSecret.length < 32) {
    throw new Error('NUXT_AUTH_SECRET must contain at least 32 characters')
  }

  return betterAuth({
    baseURL: config.public.appBaseUrl,
    secret: config.authSecret,
    database: drizzleAdapter(useDb(), { provider: 'pg', schema }),
    emailAndPassword: { enabled: false },
    plugins: [apiPlatformAuth()],
    trustedOrigins: [config.public.appBaseUrl],
  })
}

let auth: ReturnType<typeof createServerAuth> | undefined

export function useServerAuth() {
  auth ??= createServerAuth()
  return auth
}
