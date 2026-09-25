<script setup lang="ts">
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

definePageMeta({ middleware: 'auth', layout: 'app' })
useHead({ title: 'Projects' })

type Project = {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

const { data: projects, status, error, refresh } = await useFetch<Project[]>('/api/projects', {
  default: () => [],
})
const editing = ref<Project | null>(null)
const name = ref('')
const description = ref('')
const busy = ref(false)

function resetForm(project?: Project) {
  editing.value = project ?? null
  name.value = project?.name ?? ''
  description.value = project?.description ?? ''
}

async function saveProject() {
  busy.value = true

  try {
    const body = { name: name.value, description: description.value }

    if (editing.value) {
      await $fetch(`/api/projects/${editing.value.id}`, { method: 'PATCH', body })
    }
    else {
      await $fetch('/api/projects', { method: 'POST', body })
    }

    toast.success(editing.value ? 'Project updated' : 'Project created')
    resetForm()
    await refresh()
  }
  catch {
    toast.error('Could not save project')
  }
  finally {
    busy.value = false
  }
}

async function deleteProject(project: Project) {
  if (!confirm(`Delete ${project.name}?`)) return

  try {
    await $fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
    toast.success('Project deleted')
    await refresh()
  }
  catch {
    toast.error('Could not delete project')
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold">Projects</h1>
        <p class="text-muted-foreground">Your authenticated, owner-scoped workspace.</p>
      </div>
      <Button @click="resetForm()">
        <IconPlus :size="18" />
        New project
      </Button>
    </div>

    <p v-if="status === 'pending'">Loading projects…</p>

    <Card v-else-if="error" role="alert">
      <CardContent class="flex items-center justify-between pt-6">
        <span>Projects could not be loaded.</span>
        <Button variant="outline" @click="() => refresh()">Try again</Button>
      </CardContent>
    </Card>

    <Card v-else-if="!projects.length">
      <CardContent class="py-14 text-center">
        <h2 class="font-semibold">No projects yet</h2>
        <p class="text-muted-foreground">Create one to prove the full stack is working.</p>
      </CardContent>
    </Card>

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <Card v-for="project in projects" :key="project.id">
        <CardHeader>
          <CardTitle>{{ project.name }}</CardTitle>
          <CardDescription class="min-h-10">
            {{ project.description || 'No description' }}
          </CardDescription>
        </CardHeader>
        <CardContent class="flex gap-2">
          <Button variant="outline" @click="resetForm(project)">
            <IconPencil :size="16" />
            Edit
          </Button>
          <Button variant="outline" @click="deleteProject(project)">
            <IconTrash :size="16" />
            Delete
          </Button>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>{{ editing ? 'Edit project' : 'Create project' }}</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="space-y-3" @submit.prevent="saveProject">
          <label class="block space-y-1">
            <span>Name</span>
            <Input v-model="name" minlength="1" maxlength="120" required />
          </label>
          <label class="block space-y-1">
            <span>Description</span>
            <Textarea v-model="description" maxlength="1000" rows="3" />
          </label>
          <div class="flex gap-2">
            <Button type="submit" :disabled="busy">
              {{ busy ? 'Saving…' : 'Save project' }}
            </Button>
            <Button v-if="editing" type="button" variant="outline" @click="resetForm()">
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
