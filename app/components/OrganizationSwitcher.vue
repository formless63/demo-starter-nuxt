<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { Button } from '@/components/ui/button'

const { data: session } = await authClient.useSession(useFetch)
const accountId = computed(() => session.value?.user.id ?? 'anonymous')
const pagination = useCursorPagination(() => accountId.value)
const { data: organizations, refresh: refreshOrganizations, status, error } = await useFetch('/api/organizations', {
  key: computed(() => `organizations-switcher:${encodeURIComponent(accountId.value)}:${pagination.cursor.value ?? 'first'}`),
  query: computed(() => ({ cursor: pagination.cursor.value })),
})
const { data: current, refresh: refreshCurrent, status: currentStatus, error: currentError } = await useFetch('/api/organizations/current', { key: computed(() => `organization-current:${encodeURIComponent(accountId.value)}`) })
const visibleOrganizations = computed(() => status.value === 'success' ? organizations.value?.items ?? [] : [])
const visibleCurrent = computed(() => currentStatus.value === 'success' ? current.value?.active : null)
const transition = useOrganizationTransition()
const busy = ref(false)
const message = ref('')
let generation = 0
watch(accountId, () => { generation++; busy.value = false; message.value = '' }, { flush: 'sync' })
onBeforeUnmount(() => { generation++ })
async function changeSelection(organizationId?: string | null) {
  if (busy.value || transition.state.value.mutating) return
  const transitionGeneration = organizationId === undefined && transition.state.value.pending
    ? transition.state.value.generation
    : transition.begin()
  if (transitionGeneration === undefined) return
  busy.value = true
  message.value = ''
  const actorId = accountId.value, requestGeneration = ++generation
  const currentRequest = () => generation === requestGeneration && accountId.value === actorId
  try {
    if (organizationId !== undefined) {
      const result = await authClient.organization.setActive({ organizationId })
      if (currentRequest() && result.error) message.value = 'Organization selection could not be changed.'
    }
  }
  catch { if (currentRequest()) message.value = 'Organization selection could not be confirmed. Refresh before retrying.' }
  finally {
    try {
      // Never resume personalized flags from the requested value or an ambiguous write response.
      transition.settled(transitionGeneration)
      await transition.reconcile(transitionGeneration)
      if (currentRequest()) await Promise.all([refreshCurrent(), refreshOrganizations()])
    }
    catch { if (currentRequest()) message.value = 'Selection could not be refreshed. Personalized features remain hidden until refresh succeeds.' }
    finally { if (currentRequest()) busy.value = false }
  }
}
function select(event: Event) {
  return changeSelection((event.target as HTMLSelectElement).value || null)
}
</script>

<template>
  <div class="mb-5 space-y-1">
    <label for="organization-selector" class="block text-sm font-medium">Organization</label>
    <select id="organization-selector" class="w-full rounded-md border bg-background px-3 py-2 text-sm" :value="visibleCurrent?.id || ''" :disabled="busy || transition.state.value.pending || status !== 'success' || currentStatus !== 'success'" @change="select">
      <option value="">Personal workspace</option>
      <option v-if="visibleCurrent && !visibleOrganizations.some(item => item.id === visibleCurrent?.id)" :value="visibleCurrent.id">Selected organization (another page)</option>
      <option v-for="organization in visibleOrganizations" :key="organization.id" :value="organization.id">{{ organization.name }}</option>
    </select>
    <CursorPagination label="Workspace pages" :page="pagination.page.value" :has-next="!!organizations?.nextCursor && !error" :pending="busy || status === 'pending'" @previous="pagination.previous" @next="pagination.next(organizations?.nextCursor)" />
    <p v-if="error || currentError" role="alert" class="text-sm text-destructive">Organizations could not be loaded. <Button type="button" size="sm" variant="outline" :disabled="busy" @click="changeSelection()">Retry</Button></p>
    <p v-if="message" role="alert" class="text-sm text-destructive">{{ message }}</p>
    <Button v-if="transition.state.value.pending && !transition.state.value.mutating" type="button" size="sm" variant="outline" :disabled="busy" @click="changeSelection()">Refresh selection</Button>
    <p class="text-xs text-muted-foreground">Personal Projects remain personal.</p>
  </div>
</template>
