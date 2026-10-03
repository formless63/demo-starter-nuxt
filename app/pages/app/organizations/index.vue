<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { organizationRefreshKeys } from '@/utils/organization-refresh'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

definePageMeta({ layout: 'app', middleware: 'auth' })
const nuxtApp = useNuxtApp()
const { data: session } = await authClient.useSession(useFetch)
const accountId = computed(() => session.value?.user.id ?? 'anonymous')
const pagination = useCursorPagination(() => accountId.value)
const { data: organizations, refresh, status, error } = await useFetch('/api/organizations', {
  key: computed(() => `organizations-settings:${encodeURIComponent(accountId.value)}:${pagination.cursor.value ?? 'first'}`),
  query: computed(() => ({ cursor: pagination.cursor.value })),
})
const name = ref('')
const slug = ref('')
const transition = useOrganizationTransition()
const busy = ref(false)
const message = ref('')
let generation = 0
watch(accountId, () => { generation++; busy.value = false; name.value = ''; slug.value = ''; message.value = '' }, { flush: 'sync' })
onBeforeUnmount(() => { generation++ })
async function createOrganization() {
  if (busy.value) return
  const transitionGeneration = transition.begin()
  if (transitionGeneration === undefined) return
  busy.value = true
  message.value = ''
  const actorId = accountId.value, requestGeneration = ++generation
  const current = () => generation === requestGeneration && accountId.value === actorId
  try {
    const result = await authClient.organization.create({ name: name.value, slug: slug.value })
    if (!current()) return
    if (result.error) message.value = 'Organization creation failed. Refresh state before trying again.'
    else {
      name.value = ''
      slug.value = ''
      pagination.reset()
      await refreshNuxtData(organizationRefreshKeys(Object.keys(nuxtApp.payload.data), accountId.value))
    }
  }
  catch { if (current()) message.value = 'Organization creation could not be confirmed. Refresh state before trying again.' }
  finally {
    transition.settled(transitionGeneration)
    try { await transition.reconcile(transitionGeneration) }
    catch { if (current()) message.value = 'Organization state could not be refreshed. Use Refresh selection before another change.' }
    finally { if (current()) busy.value = false }
  }
}
</script>

<template>
  <div class="space-y-6">
    <div><h1 class="text-2xl font-bold">Organizations</h1><p class="text-muted-foreground">Choose a shared space for organization notes. Your personal Projects stay private.</p></div>
    <form class="grid max-w-md gap-3 rounded-lg border p-5" @submit.prevent="createOrganization">
      <h2 class="font-semibold">Create an organization</h2>
      <label for="organization-name">Name</label><Input id="organization-name" v-model="name" required maxlength="100" />
      <label for="organization-slug">Slug</label><Input id="organization-slug" v-model="slug" required minlength="3" maxlength="63" placeholder="my-organization" />
      <Button type="submit" :disabled="busy || transition.state.value.pending">Create organization</Button>
      <p v-if="message" role="alert" class="text-sm text-destructive">{{ message }}</p>
    </form>
    <p v-if="error" role="alert">Organizations could not be loaded. <Button variant="outline" :disabled="status === 'pending'" @click="refresh()">Retry</Button></p>
    <p v-if="status === 'pending'" role="status">Loading organizations…</p>
    <ul v-else-if="!error" class="grid gap-3">
      <li v-for="organization in organizations?.items" :key="organization.id" class="rounded-lg border p-4">
        <NuxtLink class="font-medium underline underline-offset-4" :to="`/app/organizations/${organization.id}`">{{ organization.name }}</NuxtLink>
        <p class="text-sm text-muted-foreground">{{ organization.slug }}</p>
      </li>
    </ul>
    <CursorPagination label="Organization pages" :page="pagination.page.value" :has-next="!!organizations?.nextCursor && !error" :pending="status === 'pending' || busy" @previous="pagination.previous" @next="pagination.next(organizations?.nextCursor)" />
  </div>
</template>
