import { createAuthClient } from 'better-auth/vue'
import { magicLinkClient } from 'better-auth/client/plugins'

/**
 * A request-scoped client for auth actions that need forwarded cookies during SSR.
 * Session rendering should use authClient.useSession(useFetch) directly so Nuxt
 * can forward incoming cookies and reuse its payload during hydration.
 */
export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  return createAuthClient({
    baseURL: url.origin,
    fetchOptions: { headers },
    plugins: [magicLinkClient()],
  })
}
