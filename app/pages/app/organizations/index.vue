<script setup lang="ts">
import { authClient } from '~~/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

definePageMeta({ layout: 'app', middleware: 'auth' })
const { data: organizations, refresh } = await useFetch('/api/organizations', { key: 'organizations-settings' })
const name = ref('')
const slug = ref('')
const busy = ref(false)
const message = ref('')
async function createOrganization() {
  busy.value = true
  message.value = ''
  const result = await authClient.organization.create({ name: name.value, slug: slug.value })
  if (result.error) message.value = 'Organization creation failed. Refresh state before trying again.'
  else {
    name.value = ''
    slug.value = ''
    await Promise.all([refresh(), refreshNuxtData(['organization-current', 'organizations-switcher'])])
  }
  busy.value = false
}
</script>

<template>
  <div class="space-y-6">
    <div><h1 class="text-2xl font-bold">Organizations</h1><p class="text-muted-foreground">Choose a shared space for organization notes. Your personal Projects stay private.</p></div>
    <form class="grid max-w-md gap-3 rounded-lg border p-5" @submit.prevent="createOrganization">
      <h2 class="font-semibold">Create an organization</h2>
      <label for="organization-name">Name</label><Input id="organization-name" v-model="name" required maxlength="100" />
      <label for="organization-slug">Slug</label><Input id="organization-slug" v-model="slug" required minlength="3" maxlength="63" placeholder="my-organization" />
      <Button type="submit" :disabled="busy">Create organization</Button>
      <p v-if="message" role="alert" class="text-sm text-destructive">{{ message }}</p>
    </form>
    <ul class="grid gap-3">
      <li v-for="organization in organizations?.items" :key="organization.id" class="rounded-lg border p-4">
        <NuxtLink class="font-medium underline underline-offset-4" :to="`/app/organizations/${organization.id}`">{{ organization.name }}</NuxtLink>
        <p class="text-sm text-muted-foreground">{{ organization.slug }}</p>
      </li>
    </ul>
  </div>
</template>
