<script setup lang="ts">
import { IconDownload, IconUpload } from '@tabler/icons-vue'
import { Button } from '@/components/ui/button'
type Transfer = { id: string, direction: string, status: string, rowCount: number | null, errorCode: string | null, validationIssues: { row: number, field?: string, code: string }[], errorsTruncated: boolean }
const { data, refresh } = await useFetch<{ items: Transfer[] }>('/api/transfers', { default: () => ({ items: [] }) })
const mounted = ref(false)
onMounted(() => { mounted.value = true })
const selected = ref<File>(), staged = ref<string>(), busy = ref(false), message = ref('')
const requestKeys = new Map<string, string>()
function key(id: string) { if (!requestKeys.has(id)) requestKeys.set(id, crypto.randomUUID()); return requestKeys.get(id)! }
async function action(run: () => Promise<unknown>) {
  busy.value = true; message.value = ''
  try { await run(); await refresh() }
  catch { message.value = 'Transfer could not be completed. Refresh status before retrying.' }
  finally { busy.value = false }
}
function select(event: Event) { selected.value = (event.target as HTMLInputElement).files?.[0]; staged.value = undefined }
function upload() {
  return action(async () => {
    if (!selected.value) return
    const receipt = await $fetch<{ id: string }>('/api/transfers/stage', { method: 'POST', body: selected.value, headers: { 'content-type': 'text/csv' } })
    staged.value = receipt.id
  })
}
function start() { return action(async () => { await $fetch<Transfer>(`/api/transfers/${staged.value}/start` as '/api/transfers/:id/start', { method: 'POST', body: { idempotencyKey: key(staged.value!) } }) }) }
function exportProjects() {
  const identity = 'export'
  return action(async () => { await $fetch('/api/transfers/export', { method: 'POST', body: { idempotencyKey: key(identity) } }); requestKeys.delete(identity) })
}
function status(id: string) { return action(async () => { await $fetch<Transfer>(`/api/transfers/${id}` as '/api/transfers/:id', { query: { refresh: 'true' } }) }) }
function cancel(id: string) { return action(async () => { await $fetch<Transfer>(`/api/transfers/${id}/cancel` as '/api/transfers/:id/cancel', { method: 'POST' }) }) }
function download(id: string) { return action(async () => { const signed = await $fetch<{ url: string }>(`/api/transfers/${id}/download` as '/api/transfers/:id/download'); window.location.assign(signed.url) }) }
</script>

<template>
  <section aria-labelledby="transfers-heading" class="space-y-4 rounded-lg border p-4">
    <h2 id="transfers-heading" class="font-semibold">Project CSV transfers</h2>
    <p class="text-sm text-muted-foreground">Columns: name,description. Import creates new personal Projects. Export adds an apostrophe to strings that may be spreadsheet formulas.</p>
    <div class="flex flex-wrap items-center gap-3">
      <label for="project-csv">CSV file</label>
      <input id="project-csv" type="file" accept=".csv,text/csv" :disabled="busy || !mounted" @change="select">
      <Button :disabled="busy || !selected" variant="outline" @click="upload"><IconUpload class="size-4" />Upload CSV</Button>
      <Button :disabled="busy || !staged" @click="start">Start import</Button>
      <Button :disabled="busy" variant="outline" @click="exportProjects"><IconDownload class="size-4" />Export Projects</Button>
      <Button :disabled="busy" variant="ghost" @click="refresh()">Refresh transfers</Button>
    </div>
    <p role="status" aria-live="polite">{{ message }}</p>
    <ul class="space-y-3">
      <li v-for="receipt in data.items" :key="receipt.id" class="rounded border p-3">
        <p>{{ receipt.direction }} — {{ receipt.status }}<span v-if="receipt.rowCount !== null"> · {{ receipt.rowCount }} rows</span></p>
        <p v-if="receipt.errorCode" class="text-sm">{{ receipt.errorCode }}</p>
        <ul v-if="receipt.validationIssues.length" aria-label="CSV validation issues">
          <li v-for="(issue, index) in receipt.validationIssues" :key="index">Row {{ issue.row }}<span v-if="issue.field">, {{ issue.field }}</span>: {{ issue.code }}</li>
        </ul>
        <p v-if="receipt.errorsTruncated">Additional validation issues were omitted.</p>
        <div class="mt-2 flex gap-2">
          <Button :disabled="busy" variant="outline" size="sm" @click="status(receipt.id)">Refresh status</Button>
          <Button v-if="['uploading', 'staged', 'pending'].includes(receipt.status)" :disabled="busy" variant="outline" size="sm" @click="cancel(receipt.id)">Cancel transfer</Button>
          <Button v-if="receipt.direction === 'export' && receipt.status === 'succeeded'" :disabled="busy" size="sm" @click="download(receipt.id)">Download CSV</Button>
        </div>
      </li>
    </ul>
  </section>
</template>
