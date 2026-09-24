import { createAuthClient } from 'better-auth/vue'
import { magicLinkClient } from 'better-auth/client/plugins'
const client = createAuthClient({ plugins: [magicLinkClient()] })
export function useAuth() {
  const session = client.useSession()
  const user = computed(() => session.value.data?.user ?? null)
  async function signOut() { await client.signOut(); await navigateTo('/') }
  return { client, session, user, signOut }
}
