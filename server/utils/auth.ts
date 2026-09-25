import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { genericOAuth, magicLink } from 'better-auth/plugins'
import * as authSchema from '../database/schema'

function createServerAuth() {
  const config = useRuntimeConfig()

  if (!config.authSecret || config.authSecret.length < 32) {
    throw new Error('NUXT_AUTH_SECRET must contain at least 32 characters')
  }

  const plugins = []

  if (config.oidcIssuer && config.oidcClientId && config.oidcClientSecret) {
    plugins.push(genericOAuth({
      config: [{
        providerId: 'oidc',
        clientId: config.oidcClientId,
        clientSecret: config.oidcClientSecret,
        discoveryUrl: `${String(config.oidcIssuer).replace(/\/$/, '')}/.well-known/openid-configuration`,
        scopes: ['openid', 'profile', 'email'],
        pkce: true,
      }],
    }))
  }

  if (config.magicLinkEnabled) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Magic links require a production email sender; disable NUXT_MAGIC_LINK_ENABLED until one is configured')
    }

    plugins.push(magicLink({
      storeToken: 'hashed',
      sendMagicLink: async ({ email, url }) => {
        console.info(`[development magic link] ${email}: ${url}`)
      },
    }))
  }

  return betterAuth({
    baseURL: config.public.appBaseUrl,
    secret: config.authSecret,
    database: drizzleAdapter(useDb(), { provider: 'pg', schema: authSchema }),
    emailAndPassword: { enabled: false },
    socialProviders: config.githubClientId && config.githubClientSecret
      ? { github: { clientId: config.githubClientId, clientSecret: config.githubClientSecret } }
      : {},
    plugins,
    advanced: { useSecureCookies: process.env.NODE_ENV === 'production' },
    trustedOrigins: [config.public.appBaseUrl],
  })
}

let auth: ReturnType<typeof createServerAuth> | undefined

export function useServerAuth() {
  auth ??= createServerAuth()
  return auth
}
