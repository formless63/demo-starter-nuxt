<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'

const { data: organizations, refresh: refreshOrganizations } = await useFetch('/api/organizations', { key: 'organizations-switcher' })
const { data: current, refresh: refreshCurrent } = await useFetch('/api/organizations/current', { key: 'organization-current' })
const busy = ref(false)
const message = ref('')
async function select(event: Event) {
  busy.value = true
  message.value = ''
  const organizationId = (event.target as HTMLSelectElement).value || null
  const result = await authClient.organization.setActive({ organizationId })
  if (result.error) message.value = 'Organization selection could not be changed.'
  await Promise.all([refreshCurrent(), refreshOrganizations(), refreshNuxtData('organization-notes')])
  busy.value = false
}
</script>

<template>
  <div class="mb-5 space-y-1">
    <label for="organization-selector" class="block text-sm font-medium">Organization</label>
    <select id="organization-selector" class="w-full rounded-md border bg-background px-3 py-2 text-sm" :value="current?.active?.id || ''" :disabled="busy" @change="select">
      <option value="">Personal workspace</option>
      <option v-for="organization in organizations?.items" :key="organization.id" :value="organization.id">{{ organization.name }}</option>
    </select>
    <p v-if="message" role="alert" class="text-sm text-destructive">{{ message }}</p>
    <p class="text-xs text-muted-foreground">Personal Projects remain personal.</p>
  </div>
</template>
