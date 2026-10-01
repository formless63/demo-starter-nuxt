<script setup lang="ts">
import { Button } from '@/components/ui/button'
const { betaDashboard } = useFeatureFlags()
const message = ref('')
async function loadPreview() {
  try { message.value = (await $fetch<{message:string}>('/api/dashboard/beta')).message }
  catch { message.value = 'Preview access requires a separate read-only permission.' }
}
</script>
<template>
  <section v-if="betaDashboard" class="space-y-3 rounded-lg border p-4" aria-label="Beta dashboard preview">
    <h2 class="font-semibold">Dashboard preview</h2><p class="text-sm text-muted-foreground">A local boolean flag reveals this optional panel. Access to its server content requires a separate permission.</p><Button variant="outline" @click="loadPreview">Read preview</Button><p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
