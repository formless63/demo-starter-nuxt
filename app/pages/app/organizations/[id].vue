<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { organizationRefreshKeys } from '@/utils/organization-refresh'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

definePageMeta({ layout: 'app', middleware: 'auth' })
const nuxtApp = useNuxtApp()
const route = useRoute()
const organizationId = computed(() => String(route.params.id))
const { data: session } = await authClient.useSession(useFetch)
const accountId = computed(() => session.value?.user.id ?? 'anonymous')
const pagination = useCursorPagination(() => JSON.stringify([accountId.value, organizationId.value]))
const { data: ownMembership, refresh: refreshContext, status: contextStatus, error: contextError } = await useFetch(() => `/api/organizations/${encodeURIComponent(organizationId.value)}/context`, {
  key: computed(() => `organization-context:${encodeURIComponent(accountId.value)}:${encodeURIComponent(organizationId.value)}`),
})
const { data: members, refresh: refreshMembers, status: membersStatus, error: membersError } = await useFetch(() => `/api/organizations/${encodeURIComponent(organizationId.value)}/members`, {
  key: computed(() => `organization-members:${encodeURIComponent(accountId.value)}:${encodeURIComponent(organizationId.value)}:${pagination.cursor.value ?? 'first'}`),
  query: computed(() => ({ cursor: pagination.cursor.value })),
})
const { data: notes, refresh: refreshNotes, error: notesError, status: notesStatus } = await useFetch(() => `/api/organizations/${encodeURIComponent(organizationId.value)}/notes`, {
  key: computed(() => `organization-notes:${encodeURIComponent(accountId.value)}:${encodeURIComponent(organizationId.value)}`),
})
const detailsReady = computed(() => contextStatus.value === 'success' && ownMembership.value?.organization.id === organizationId.value)
const canManage = computed(() => detailsReady.value && (ownMembership.value?.role === 'owner' || ownMembership.value?.role === 'admin'))
const name = ref('')
const slug = ref('')
const title = ref('')
const email = ref('')
const role = ref<'admin' | 'member'>('member')
const copyLink = ref('')
const createdInvitationId = ref('')
const message = ref('')
const transition = useOrganizationTransition()
const busy = ref(false)
let generation = 0
let disposed = false
watch(() => ownMembership.value?.organization, details => {
  name.value = details?.id === organizationId.value ? details.name : ''
  slug.value = details?.id === organizationId.value ? details.slug : ''
}, { immediate: true })
watch([organizationId, accountId], () => {
  generation++
  busy.value = false
  name.value = ''; slug.value = ''; title.value = ''; email.value = ''
  role.value = 'member'; copyLink.value = ''; createdInvitationId.value = ''; message.value = ''
}, { flush: 'sync' })
onBeforeUnmount(() => { disposed = true; generation++ })
async function mutate(failure: string, operation: (id: string, current: () => boolean) => Promise<void>) {
  if (busy.value || !detailsReady.value) return
  const id = organizationId.value, actorId = accountId.value, requestGeneration = ++generation
  const current = () => !disposed && generation === requestGeneration && organizationId.value === id && accountId.value === actorId
  busy.value = true
  message.value = ''
  try { await operation(id, current) }
  catch { if (current()) message.value = failure }
  finally { if (current()) busy.value = false }
}
function refreshSharedOrganizations() {
  return refreshNuxtData(organizationRefreshKeys(Object.keys(nuxtApp.payload.data), accountId.value))
}
async function updateOrganization() {
  await mutate('Organization update could not be confirmed. Refresh before retrying.', async (id, current) => {
    const result = await authClient.organization.update({ organizationId: id, data: { name: name.value, slug: slug.value } })
    if (!current()) return
    if (result.error) { message.value = 'Organization could not be updated.'; return }
    await Promise.all([refreshContext(), refreshSharedOrganizations()])
    if (current()) message.value = 'Organization updated.'
  })
}
async function createNote() {
  await mutate('Note could not be saved.', async (id, current) => {
    await $fetch(`/api/organizations/${encodeURIComponent(id)}/notes`, { method: 'POST', body: { title: title.value } })
    if (!current()) return
    title.value = ''
    await refreshNotes()
  })
}
async function invite() {
  await mutate('Invitation creation could not be confirmed. Refresh before retrying.', async (id, current) => {
    copyLink.value = ''; createdInvitationId.value = ''
    const result = await authClient.organization.inviteMember({ organizationId: id, email: email.value, role: role.value })
    if (!current()) return
    if (result.error || !result.data) message.value = 'Invitation could not be created. Refresh state before retrying.'
    else {
      createdInvitationId.value = result.data.id
      copyLink.value = new URL(`/app/invitations/${encodeURIComponent(result.data.id)}`, window.location.origin).toString()
      message.value = 'Invitation created. No email was sent. Copy this link for the recipient.'
    }
  })
}
async function cancelInvitation() {
  await mutate('Invitation cancellation could not be confirmed. Refresh before retrying.', async (_id, current) => {
    const invitationId = createdInvitationId.value
    if (!invitationId) return
    const result = await authClient.organization.cancelInvitation({ invitationId })
    if (!current()) return
    message.value = result.error ? 'Invitation could not be cancelled.' : 'Invitation cancelled.'
    if (!result.error && createdInvitationId.value === invitationId) { createdInvitationId.value = ''; copyLink.value = '' }
  })
}
async function removeMember(memberId: string) {
  await mutate('Member removal could not be confirmed. Refresh before retrying.', async (id, current) => {
    const result = await authClient.organization.removeMember({ organizationId: id, memberIdOrEmail: memberId })
    if (!current()) return
    message.value = result.error ? 'Member could not be removed.' : 'Member removed.'
    if (!result.error) pagination.reset()
    await refreshMembers()
  })
}
async function changeRole(memberId: string, next: 'admin' | 'member') {
  await mutate('Role change could not be confirmed. Refresh before retrying.', async (id, current) => {
    const result = await authClient.organization.updateMemberRole({ organizationId: id, memberId, role: next })
    if (!current()) return
    message.value = result.error ? 'Role could not be changed.' : 'Role changed.'
    await refreshMembers()
  })
}
async function leave() {
  await mutate('Leaving could not be confirmed. Refresh before retrying.', async (id, current) => {
    const transitionGeneration = transition.begin()
    if (transitionGeneration === undefined) { message.value = 'Wait for the current selection change or refresh it before leaving.'; return }
    let left = false
    try {
      const result = await authClient.organization.leave({ organizationId: id })
      left = !result.error
      if (current() && result.error) message.value = 'Organization could not be left.'
    }
    finally {
      // This read is independent of the page route. A late older completion cannot settle a newer switch.
      transition.settled(transitionGeneration)
      await transition.reconcile(transitionGeneration)
      if (current()) await refreshSharedOrganizations()
    }
    if (left && current()) await navigateTo('/app/organizations')
  })
}
</script>

<template>
  <div class="space-y-6">
    <div><h1 class="text-2xl font-bold">Organization settings</h1><p class="text-muted-foreground">Membership controls this shared notes space.</p></div>
    <p v-if="message" role="status" class="text-sm">{{ message }}</p>
    <p v-if="notesError || contextError" role="alert" class="text-destructive">This organization is unavailable or you are no longer a member.</p>
    <form v-if="detailsReady && ownMembership?.role === 'owner'" class="grid max-w-md gap-3 rounded-lg border p-5" @submit.prevent="updateOrganization">
      <h2 class="font-semibold">Organization details</h2><label for="organization-name">Name</label><Input id="organization-name" v-model="name" :disabled="busy" required maxlength="100" /><label for="organization-slug">Slug</label><Input id="organization-slug" v-model="slug" :disabled="busy" required minlength="3" maxlength="63" /><Button type="submit" :disabled="busy">Save details</Button>
    </form>
    <section v-if="detailsReady && notesStatus === 'success' && !notesError" class="space-y-3 rounded-lg border p-5">
      <h2 class="text-lg font-semibold">Organization notes</h2>
      <form v-if="canManage" class="flex gap-2" @submit.prevent="createNote">
        <label for="organization-note-title" class="sr-only">Note title</label><Input id="organization-note-title" v-model="title" required maxlength="120" placeholder="A shared note" />
        <Button type="submit" :disabled="busy">Add note</Button>
      </form>
      <p v-else class="text-sm text-muted-foreground">You can read notes. An owner or admin can add or edit them.</p>
      <ul class="space-y-2"><li v-for="note in notes" :key="note.id" class="rounded border p-3">{{ note.title }}</li></ul>
    </section>
    <section class="space-y-3 rounded-lg border p-5">
      <h2 class="text-lg font-semibold">Members</h2>
      <p v-if="membersError" role="alert">Members could not be loaded. <Button variant="outline" :disabled="membersStatus === 'pending'" @click="refreshMembers()">Retry</Button></p>
      <p v-if="membersStatus === 'pending'" role="status">Loading members…</p>
      <ul v-else-if="detailsReady && !membersError" class="space-y-2">
        <li v-for="member in members?.items" :key="member.id" class="flex flex-wrap items-center gap-3 rounded border p-3">
          <span class="break-all text-sm">{{ member.userId }}</span><span class="ml-auto text-sm">{{ member.role }}</span>
          <template v-if="canManage && member.role !== 'owner' && (ownMembership?.role === 'owner' || member.role === 'member')">
            <Button v-if="ownMembership?.role === 'owner'" size="sm" variant="outline" :disabled="busy" @click="changeRole(member.id, member.role === 'admin' ? 'member' : 'admin')">{{ member.role === 'admin' ? 'Make member' : 'Make admin' }}</Button>
            <Button size="sm" variant="outline" :disabled="busy" @click="removeMember(member.id)">Remove member</Button>
          </template>
        </li>
      </ul>
      <CursorPagination label="Member pages" :page="pagination.page.value" :has-next="!!members?.nextCursor && !membersError" :pending="busy || membersStatus === 'pending'" @previous="pagination.previous" @next="pagination.next(members?.nextCursor)" />
      <Button v-if="detailsReady && ownMembership && ownMembership.role !== 'owner'" variant="outline" :disabled="busy || transition.state.value.pending" @click="leave">Leave organization</Button>
    </section>
    <form v-if="canManage" class="grid max-w-md gap-3 rounded-lg border p-5" @submit.prevent="invite">
      <h2 class="font-semibold">Invite a member</h2><label for="invitation-email">Recipient email</label><Input id="invitation-email" v-model="email" type="email" required maxlength="254" />
      <template v-if="ownMembership?.role === 'owner'"><label for="invitation-role">Role</label><select id="invitation-role" v-model="role" class="rounded border p-2"><option value="member">Member</option><option value="admin">Admin</option></select></template>
      <Button type="submit" :disabled="busy">Create invitation</Button>
      <template v-if="copyLink"><label for="invitation-link">Invitation link</label><Input id="invitation-link" :model-value="copyLink" readonly /><p class="text-xs text-muted-foreground">Share only with the intended recipient.</p><Button type="button" variant="outline" :disabled="busy" @click="cancelInvitation">Cancel invitation</Button></template>
    </form>
  </div>
</template>
