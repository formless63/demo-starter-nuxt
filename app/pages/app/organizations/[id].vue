<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

definePageMeta({ layout: 'app', middleware: 'auth' })
const route = useRoute()
const organizationId = computed(() => String(route.params.id))
const { data: ownMembership } = await useFetch(() => `/api/organizations/${encodeURIComponent(organizationId.value)}/context`)
const { data: members, refresh: refreshMembers } = await useFetch(() => `/api/organizations/${encodeURIComponent(organizationId.value)}/members`)
const { data: notes, refresh: refreshNotes, error: notesError } = await useFetch(() => `/api/organizations/${encodeURIComponent(organizationId.value)}/notes`, { key: 'organization-notes' })
const canManage = computed(() => ownMembership.value?.role === 'owner' || ownMembership.value?.role === 'admin')
const name = ref('')
const slug = ref('')
const title = ref('')
const email = ref('')
const role = ref<'admin' | 'member'>('member')
const copyLink = ref('')
const createdInvitationId = ref('')
const message = ref('')
const busy = ref(false)
async function updateOrganization() {
  const result = await authClient.organization.update({ organizationId: organizationId.value, data: { name: name.value, slug: slug.value } })
  message.value = result.error ? 'Organization could not be updated.' : 'Organization updated.'
}
async function createNote() {
  busy.value = true
  message.value = ''
  try {
    await $fetch(`/api/organizations/${encodeURIComponent(organizationId.value)}/notes`, { method: 'POST', body: { title: title.value } })
    title.value = ''
    await refreshNotes()
  }
  catch { message.value = 'Note could not be saved.' }
  busy.value = false
}
async function invite() {
  busy.value = true
  copyLink.value = ''
  message.value = ''
  const result = await authClient.organization.inviteMember({ organizationId: organizationId.value, email: email.value, role: role.value })
  if (result.error || !result.data) message.value = 'Invitation could not be created. Refresh state before retrying.'
  else {
    createdInvitationId.value = result.data.id
    copyLink.value = new URL(`/app/invitations/${encodeURIComponent(result.data.id)}`, window.location.origin).toString()
    message.value = 'Invitation created. No email was sent. Copy this link for the recipient.'
  }
  busy.value = false
}
async function cancelInvitation() {
  const result = await authClient.organization.cancelInvitation({ invitationId: createdInvitationId.value })
  message.value = result.error ? 'Invitation could not be cancelled.' : 'Invitation cancelled.'
  if (!result.error) { createdInvitationId.value = ''; copyLink.value = '' }
}
async function removeMember(id: string) {
  busy.value = true
  const result = await authClient.organization.removeMember({ organizationId: organizationId.value, memberIdOrEmail: id })
  message.value = result.error ? 'Member could not be removed.' : 'Member removed.'
  await refreshMembers()
  busy.value = false
}
async function changeRole(id: string, next: 'admin' | 'member') {
  busy.value = true
  const result = await authClient.organization.updateMemberRole({ organizationId: organizationId.value, memberId: id, role: next })
  message.value = result.error ? 'Role could not be changed.' : 'Role changed.'
  await refreshMembers()
  busy.value = false
}
async function leave() {
  const result = await authClient.organization.leave({ organizationId: organizationId.value })
  if (result.error) message.value = 'Organization could not be left.'
  else await navigateTo('/app/organizations')
}
</script>

<template>
  <div class="space-y-6">
    <div><h1 class="text-2xl font-bold">Organization settings</h1><p class="text-muted-foreground">Membership controls this shared notes space.</p></div>
    <p v-if="message" role="status" class="text-sm">{{ message }}</p>
    <p v-if="notesError" role="alert" class="text-destructive">This organization is unavailable or you are no longer a member.</p>
    <form v-if="ownMembership?.role === 'owner'" class="grid max-w-md gap-3 rounded-lg border p-5" @submit.prevent="updateOrganization">
      <h2 class="font-semibold">Organization details</h2><label for="organization-name">Name</label><Input id="organization-name" v-model="name" required maxlength="100" /><label for="organization-slug">Slug</label><Input id="organization-slug" v-model="slug" required minlength="3" maxlength="63" /><Button type="submit">Save details</Button>
    </form>
    <section v-if="!notesError" class="space-y-3 rounded-lg border p-5">
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
      <ul class="space-y-2">
        <li v-for="member in members?.items" :key="member.id" class="flex flex-wrap items-center gap-3 rounded border p-3">
          <span class="break-all text-sm">{{ member.userId }}</span><span class="ml-auto text-sm">{{ member.role }}</span>
          <template v-if="canManage && member.role !== 'owner' && (ownMembership?.role === 'owner' || member.role === 'member')">
            <Button v-if="ownMembership?.role === 'owner'" size="sm" variant="outline" :disabled="busy" @click="changeRole(member.id, member.role === 'admin' ? 'member' : 'admin')">{{ member.role === 'admin' ? 'Make member' : 'Make admin' }}</Button>
            <Button size="sm" variant="outline" :disabled="busy" @click="removeMember(member.id)">Remove member</Button>
          </template>
        </li>
      </ul>
      <Button v-if="ownMembership && ownMembership.role !== 'owner'" variant="outline" @click="leave">Leave organization</Button>
    </section>
    <form v-if="canManage" class="grid max-w-md gap-3 rounded-lg border p-5" @submit.prevent="invite">
      <h2 class="font-semibold">Invite a member</h2><label for="invitation-email">Recipient email</label><Input id="invitation-email" v-model="email" type="email" required maxlength="254" />
      <template v-if="ownMembership?.role === 'owner'"><label for="invitation-role">Role</label><select id="invitation-role" v-model="role" class="rounded border p-2"><option value="member">Member</option><option value="admin">Admin</option></select></template>
      <Button type="submit" :disabled="busy">Create invitation</Button>
      <template v-if="copyLink"><label for="invitation-link">Invitation link</label><Input id="invitation-link" :model-value="copyLink" readonly /><p class="text-xs text-muted-foreground">Share only with the intended recipient.</p><Button type="button" variant="outline" @click="cancelInvitation">Cancel invitation</Button></template>
    </form>
  </div>
</template>
