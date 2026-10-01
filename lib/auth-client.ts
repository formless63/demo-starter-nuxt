import { createAuthClient } from 'better-auth/vue'
import { organizationClient } from '@repo/nuxt-organizations/client'
import { magicLinkClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [magicLinkClient(), organizationClient()],
})
