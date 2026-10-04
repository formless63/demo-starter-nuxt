import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organizationsAuth, organizationAuthErrorBoundary } from '@repo/nuxt-organizations/server'
import { genericOAuth, magicLink } from 'better-auth/plugins'
import { apiPlatformAuth } from '@repo/nuxt-api/server'
import { EmailError, renderMagicLinkEmail, resolveEmailConfig } from '@repo/nuxt-email/server'
import { sendObservedEmail } from './observed-email'
import * as authSchema from '../database/schema'

type AuthConfiguration = {
  oidcIssuer?: string
  oidcClientId?: string
  oidcClientSecret?: string
  public?: { appBaseUrl: string }
  magicLinkEnabled?: boolean
  githubClientId?: string
  githubClientSecret?: string
}

export function configuredAuthPlugins(config: AuthConfiguration) {
  const [organizations, guard] = organizationsAuth()
  const plugins: [ReturnType<typeof apiPlatformAuth>, typeof organizations, ...BetterAuthPlugin[]] = [apiPlatformAuth(), organizations, guard]

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
    resolveEmailConfig()

    plugins.push(magicLink({
      storeToken: 'hashed',
      sendMagicLink: async ({ email, url }) => {
        const content = renderMagicLinkEmail(url, config.public?.appBaseUrl ?? '')
        const result = await sendObservedEmail({ to: [{ address: email }], ...content })
        // The app requires full acceptance; ambiguity is not an automatic retry.
        if (result.outcome !== 'accepted') throw new EmailError('unknown')
      },
    }))
  }

  return plugins
}

export function configuredSocialProviders(config: AuthConfiguration) {
  return config.githubClientId && config.githubClientSecret
    ? { github: { clientId: config.githubClientId, clientSecret: config.githubClientSecret } }
    : {}
}

function createServerAuth() {
  const config = useRuntimeConfig()

  if (!config.authSecret || config.authSecret.length < 32) {
    throw new Error('NUXT_AUTH_SECRET must contain at least 32 characters')
  }

  return betterAuth({
    baseURL: config.public.appBaseUrl,
    secret: config.authSecret,
    database: drizzleAdapter(useAuthDb(), { provider: 'pg', schema: authSchema, transaction: true }),
    emailAndPassword: { enabled: false },
    user: { deleteUser: { enabled: false } },
    onAPIError: organizationAuthErrorBoundary,
    socialProviders: configuredSocialProviders(config),
    plugins: configuredAuthPlugins(config),
    advanced: { useSecureCookies: process.env.NODE_ENV === 'production' },
    trustedOrigins: [config.public.appBaseUrl],
  })
}

let auth: ReturnType<typeof createServerAuth> | undefined

export function useServerAuth() {
  auth ??= createServerAuth()
  return auth
}
