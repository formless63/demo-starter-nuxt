<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { organizationRefreshKeys } from '@/utils/organization-refresh'
import { Button } from '@/components/ui/button'

definePageMeta({ layout: 'app', middleware: 'auth' })
const nuxtApp = useNuxtApp()
const { data: session } = await authClient.useSession(useFetch)
const route = useRoute()
const message = ref('Sign in with the invited verified email address to accept.')
const busy = ref(false)
const transition = useOrganizationTransition()
let generation = 0
watch(() => [route.params.id, session.value?.user.id], () => { generation++; busy.value = false }, { flush: 'sync' })
onBeforeUnmount(() => { generation++ })
async function respond(accept: boolean) {
  if (busy.value) return
  const transitionGeneration = accept ? transition.begin() : undefined
  if (accept && transitionGeneration === undefined) return
  busy.value = true
  const requestGeneration = ++generation, invitationId = String(route.params.id)
  const current = () => generation === requestGeneration
  let accepted = false
  try {
    const result = accept ? await authClient.organization.acceptInvitation({ invitationId }) : await authClient.organization.rejectInvitation({ invitationId })
    if (!current()) return
    if (result.error) message.value = 'The invitation could not be used. Verify your email and refresh membership before retrying.'
    else if (accept) {
      accepted = true
      await refreshNuxtData(organizationRefreshKeys(Object.keys(nuxtApp.payload.data), session.value?.user.id ?? 'anonymous'))
    }
    else message.value = 'Invitation rejected.'
  }
  catch { if (current()) message.value = 'The invitation result could not be confirmed. Refresh membership before retrying.' }
  finally {
    if (transitionGeneration !== undefined) {
      transition.settled(transitionGeneration)
      try { await transition.reconcile(transitionGeneration) }
      catch { accepted = false; if (current()) message.value = 'Membership could not be refreshed. Use Refresh selection before retrying.' }
    }
    if (current()) busy.value = false
  }
  if (accepted && current()) await navigateTo('/app/organizations')
}
</script>

<template>
  <section class="max-w-lg space-y-4 rounded-lg border p-6">
    <h1 class="text-xl font-bold">Organization invitation</h1><p role="status">{{ message }}</p>
    <div class="flex gap-3"><Button :disabled="busy || transition.state.value.pending" @click="respond(true)">Accept invitation</Button><Button :disabled="busy" variant="outline" @click="respond(false)">Reject invitation</Button></div>
  </section>
</template>
