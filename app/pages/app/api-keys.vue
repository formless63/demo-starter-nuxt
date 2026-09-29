<script setup lang="ts">
import { IconBan, IconCopy, IconKey, IconTrash } from '@tabler/icons-vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

definePageMeta({ middleware: 'auth', layout: 'app' })
useHead({ title: 'API keys' })

type SafeApiKey = {
  id: string
  name: string | null
  start: string | null
  prefix: string | null
  enabled: boolean
  permissions: Record<string, string[]> | null
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

const { data: keys, refresh } = await useFetch<SafeApiKey[]>('/api/api-keys', { default: () => [] })
const name = ref('')
const canRead = ref(true)
const canWrite = ref(false)
const expiresInDays = ref<number | undefined>()
const revealedSecret = ref<string | null>(null)
const busy = ref(false)

async function createKey() {
  busy.value = true
  try {
    const created = await $fetch<SafeApiKey & { secret: string }>('/api/api-keys', {
      method: 'POST',
      body: {
        name: name.value,
        permissions: { read: canRead.value, write: canWrite.value },
        expiresInDays: expiresInDays.value ?? null,
      },
    })
    revealedSecret.value = created.secret
    name.value = ''
    canRead.value = true
    canWrite.value = false
    expiresInDays.value = undefined
    await refresh()
    toast.success('API key created')
  }
  catch {
    toast.error('Could not create API key')
  }
  finally {
    busy.value = false
  }
}

async function copySecret() {
  if (!revealedSecret.value) return
  await navigator.clipboard.writeText(revealedSecret.value)
  toast.success('Secret copied')
}

async function revokeKey(key: SafeApiKey) {
  await $fetch(`/api/api-keys/${key.id}`, { method: 'PATCH' })
  await refresh()
  toast.success('API key revoked')
}

async function deleteKey(key: SafeApiKey) {
  if (!confirm(`Delete ${key.name || key.start || 'this API key'}?`)) return
  await $fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' })
  await refresh()
  toast.success('API key deleted')
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-3xl font-bold">API keys</h1>
      <p class="text-muted-foreground">Create user-owned machine credentials for the external API.</p>
    </div>

    <Card v-if="revealedSecret" class="border-amber-500/50">
      <CardHeader>
        <CardTitle>Copy this secret now</CardTitle>
        <CardDescription>It will not be shown again after you dismiss this message.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <code class="block overflow-x-auto rounded bg-muted p-3 text-sm">{{ revealedSecret }}</code>
        <div class="flex gap-2">
          <Button type="button" @click="copySecret">
            <IconCopy :size="16" />
            Copy
          </Button>
          <Button type="button" variant="outline" @click="revealedSecret = null">
            I saved it
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Create an API key</CardTitle>
        <CardDescription>For rotation, create the replacement before revoking the old key.</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="space-y-4" @submit.prevent="createKey">
          <label class="block space-y-1">
            <span>Name</span>
            <Input v-model="name" maxlength="32" required />
          </label>
          <fieldset class="space-y-2">
            <legend class="font-medium">Project permissions</legend>
            <label class="flex items-center gap-2">
              <input v-model="canRead" type="checkbox">
              Read projects
            </label>
            <label class="flex items-center gap-2">
              <input v-model="canWrite" type="checkbox">
              Create projects
            </label>
          </fieldset>
          <label class="block space-y-1">
            <span>Expires in days <span class="text-muted-foreground">(optional)</span></span>
            <Input v-model.number="expiresInDays" type="number" min="1" max="3650" />
          </label>
          <Button type="submit" :disabled="busy || (!canRead && !canWrite)">
            <IconKey :size="16" />
            {{ busy ? 'Creating…' : 'Create key' }}
          </Button>
        </form>
      </CardContent>
    </Card>

    <div class="grid gap-3">
      <Card v-for="key in keys" :key="key.id">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            {{ key.name || 'Unnamed key' }}
            <span v-if="!key.enabled" class="text-sm font-normal text-destructive">Revoked</span>
          </CardTitle>
          <CardDescription>
            {{ key.start || key.prefix || 'Hidden prefix' }} ·
            Last used {{ key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'never' }} ·
            Expires {{ key.expiresAt ? new Date(key.expiresAt).toLocaleString() : 'never' }}
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-wrap items-center gap-2">
          <span class="mr-auto text-sm text-muted-foreground">
            {{ key.permissions?.projects?.join(', ') || 'No permissions' }}
          </span>
          <Button v-if="key.enabled" type="button" variant="outline" @click="revokeKey(key)">
            <IconBan :size="16" />
            Revoke
          </Button>
          <Button type="button" variant="destructive" @click="deleteKey(key)">
            <IconTrash :size="16" />
            Delete
          </Button>
        </CardContent>
      </Card>
      <p v-if="!keys.length" class="text-muted-foreground">No API keys yet.</p>
    </div>
  </div>
</template>
