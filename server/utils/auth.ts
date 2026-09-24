import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { genericOAuth, magicLink } from 'better-auth/plugins'
import * as authSchema from '../database/schema'

export function useServerAuth() {
  const c=useRuntimeConfig(); if(!c.authSecret || c.authSecret.length<32) throw new Error('NUXT_AUTH_SECRET must contain at least 32 characters')
  const plugins=[]
  if(c.oidcIssuer&&c.oidcClientId&&c.oidcClientSecret) plugins.push(genericOAuth({config:[{providerId:'oidc',clientId:c.oidcClientId,clientSecret:c.oidcClientSecret,discoveryUrl:`${String(c.oidcIssuer).replace(/\/$/,'')}/.well-known/openid-configuration`,scopes:['openid','profile','email'],pkce:true}]}))
  if(c.magicLinkEnabled) {
    if(process.env.NODE_ENV==='production') throw new Error('Magic links require a production email sender; disable NUXT_MAGIC_LINK_ENABLED until one is configured')
    plugins.push(magicLink({sendMagicLink: async ({email,url})=>console.info(`[development magic link] ${email}: ${url}`)}))
  }
  return betterAuth({ baseURL:c.public.appBaseUrl, secret:c.authSecret, database:drizzleAdapter(useDb(),{provider:'pg',schema:authSchema}), emailAndPassword:{enabled:false}, socialProviders:c.githubClientId&&c.githubClientSecret?{github:{clientId:c.githubClientId,clientSecret:c.githubClientSecret}}:{}, plugins, advanced:{useSecureCookies:process.env.NODE_ENV==='production'}, trustedOrigins:[c.public.appBaseUrl] })
}
