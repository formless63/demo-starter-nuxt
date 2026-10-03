<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { Button } from '@/components/ui/button'

definePageMeta({ layout: 'app', middleware: 'auth' })
const route = useRoute()
const message = ref('Sign in with the invited verified email address to accept.')
const busy = ref(false)
async function respond(accept: boolean) {
  busy.value = true
  const invitationId = String(route.params.id)
  const result = accept ? await authClient.organization.acceptInvitation({ invitationId }) : await authClient.organization.rejectInvitation({ invitationId })
  if (result.error) message.value = 'The invitation could not be used. Verify your email and refresh membership before retrying.'
  else if (accept) {
    await refreshNuxtData(['organization-current', 'organizations-switcher'])
    await navigateTo('/app/organizations')
  }
  else message.value = 'Invitation rejected.'
  busy.value = false
}
</script>

<template>
  <section class="max-w-lg space-y-4 rounded-lg border p-6">
    <h1 class="text-xl font-bold">Organization invitation</h1><p role="status">{{ message }}</p>
    <div class="flex gap-3"><Button :disabled="busy" @click="respond(true)">Accept invitation</Button><Button :disabled="busy" variant="outline" @click="respond(false)">Reject invitation</Button></div>
  </section>
</template>
