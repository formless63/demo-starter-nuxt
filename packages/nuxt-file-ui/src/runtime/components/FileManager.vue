<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { createFileClient, type FileClient } from '../client'
import type { FileView } from '../contract'

const props = withDefaults(defineProps<{
  client?: FileClient
  endpoint?: string
  maxBytes?: number
  label?: string
}>(), { client: undefined, endpoint: '/api/files', maxBytes: 10 * 1024 * 1024, label: 'Files' })

watch(() => props.maxBytes, (value) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('FileManager maxBytes must be a positive safe integer')
}, { immediate: true, flush: 'sync' })

// Each mounted component owns its transport, selection and request lifetimes.
const client = computed(() => props.client ?? createFileClient(props.endpoint))
const id = useId()
const files = shallowRef<FileView[]>([])
const selection = shallowRef<{ readonly file: File; readonly key: string } | null>(null)
const input = ref<HTMLInputElement | null>(null)
const retry = ref(false)
const loading = ref(true)
const pending = ref<'upload' | 'cancel' | 'remove' | null>(null)
const status = ref('Loading files…')
const error = ref<string | null>(null)
let mounted = false
let listRequest: { controller: AbortController } | null = null
let mutation: { controller?: AbortController } | null = null

const stateLabels: Record<FileView['state'], string> = {
  uploading: 'Awaiting upload confirmation',
  ready: 'Ready',
  'cleanup-pending': 'Cleanup pending',
  removed: 'Removed',
}
const buttonClass = 'rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
function attachmentUrl(file: FileView) {
  if (file.state !== 'ready') return undefined
  try {
    const value = client.value.downloadUrl(file.id)
    if (!value.trim()) return undefined
    const parsed = new URL(value, 'https://file-ui.invalid')
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : undefined
  }
  catch { return undefined }
}
const rows = computed(() => files.value.map(file => ({ file, url: attachmentUrl(file) })))

function stopListRequest() {
  const previous = listRequest
  listRequest = null
  previous?.controller.abort()
  loading.value = false
}
function resetScope() {
  stopListRequest()
  const previous = mutation
  mutation = null
  previous?.controller?.abort()
  files.value = []
  selection.value = null
  retry.value = false
  pending.value = null
  error.value = null
  status.value = 'Loading files…'
  if (input.value) input.value.value = ''
}
function upsert(file: FileView) {
  files.value = files.value.some(item => item.id === file.id)
    ? files.value.map(item => item.id === file.id ? file : item)
    : [file, ...files.value]
}
async function loadFiles() {
  if (!mounted || mutation) return
  stopListRequest()
  const request = { controller: new AbortController() }
  listRequest = request
  loading.value = true
  error.value = null
  status.value = 'Loading files…'
  try {
    const result = await client.value.list(request.controller.signal)
    if (!mounted || listRequest !== request) return
    files.value = result
    status.value = `${result.length} file${result.length === 1 ? '' : 's'} loaded.`
  }
  catch {
    if (!mounted || listRequest !== request) return
    error.value = 'Could not refresh files. The displayed list may be out of date.'
    status.value = ''
  }
  finally {
    if (mounted && listRequest === request) {
      listRequest = null
      loading.value = false
    }
  }
}
function chooseFile(event: Event) {
  if (mutation) return
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  error.value = null
  retry.value = false
  selection.value = null
  if (!file) {
    status.value = 'No file selected.'
    return
  }
  if (file.size > props.maxBytes) {
    target.value = ''
    error.value = `Choose a file no larger than ${formatBytes(props.maxBytes)}.`
    status.value = ''
    return
  }
  selection.value = Object.freeze({ file, key: crypto.randomUUID() })
  status.value = `${file.name} selected. Ready to upload.`
}
async function upload() {
  // The synchronous mutex also covers repeated submits before Vue updates the DOM.
  const selected = selection.value
  if (!mounted || mutation || !selected) return
  if (selected.file.size > props.maxBytes) {
    error.value = `Choose a file no larger than ${formatBytes(props.maxBytes)}.`
    return
  }
  const operation = { controller: new AbortController() }
  mutation = operation
  stopListRequest()
  pending.value = 'upload'
  error.value = null
  status.value = `Uploading ${selected.file.name}…`
  try {
    // Preserve both the original File and key when the server outcome is uncertain.
    const result = await client.value.upload(selected.file, selected.key, operation.controller.signal)
    if (!mounted || mutation !== operation) return
    upsert(result)
    if (result.state === 'ready') {
      status.value = operation.controller.signal.aborted
        ? 'The server confirmed the upload completed despite local cancellation.'
        : `Uploaded ${result.name}.`
      selection.value = null
      retry.value = false
      if (input.value) input.value.value = ''
    }
    else {
      retry.value = true
      status.value = result.state === 'uploading'
        ? 'Upload is awaiting confirmation. Refresh or retry this upload to check its status.'
        : `Upload is not available: ${stateLabels[result.state].toLowerCase()}. Refresh to check its status.`
    }
  }
  catch {
    if (!mounted || mutation !== operation) return
    retry.value = true
    if (operation.controller.signal.aborted) {
      status.value = 'Upload cancelled locally. The server may still have received it. Refresh or retry this upload to confirm.'
    }
    else {
      status.value = ''
      error.value = 'Upload could not be confirmed. The server may still have received it. Refresh or retry this upload; its original file and request key are preserved.'
    }
  }
  finally {
    if (mounted && mutation === operation) {
      mutation = null
      pending.value = null
    }
  }
}
function cancelUpload() {
  const operation = mutation
  if (!operation?.controller || operation.controller.signal.aborted) return
  pending.value = 'cancel'
  status.value = 'Cancellation requested. Waiting for this request to settle; the server may still finish the upload.'
  operation.controller.abort()
}
function clearSelection() {
  if (mutation) return
  selection.value = null
  status.value = retry.value
    ? 'Selection cleared. The earlier upload is still unconfirmed; refresh files to check it.'
    : 'Selection cleared.'
  retry.value = false
  error.value = null
  if (input.value) input.value.value = ''
}
async function remove(file: FileView) {
  if (!mounted || mutation) return
  const operation = {}
  mutation = operation
  stopListRequest()
  pending.value = 'remove'
  error.value = null
  status.value = `Removing ${file.name}…`
  try {
    const result = await client.value.remove(file.id)
    if (!mounted || mutation !== operation) return
    upsert(result)
    status.value = result.state === 'removed'
      ? `Removed ${result.name}.`
      : result.state === 'cleanup-pending'
        ? 'Removal is pending storage cleanup. Refresh or retry removal to confirm.'
        : 'Removal has not been confirmed. Refresh to check the file status.'
  }
  catch {
    if (!mounted || mutation !== operation) return
    status.value = ''
    error.value = 'Removal could not be confirmed. Refresh to check the file status before retrying.'
  }
  finally {
    if (mounted && mutation === operation) {
      mutation = null
      pending.value = null
    }
  }
}

// Never expose records, retained files, or responses from a previous client scope.
watch(client, () => {
  resetScope()
  if (mounted) void loadFiles()
}, { flush: 'sync' })
onMounted(() => {
  mounted = true
  void loadFiles()
})
onBeforeUnmount(() => {
  mounted = false
  resetScope()
})
</script>

<template>
  <section :aria-labelledby="`${id}-heading`" class="file-manager space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 :id="`${id}-heading`" class="text-xl font-semibold">{{ label }}</h2>
      <button type="button" :class="buttonClass" :disabled="loading || pending !== null" @click="loadFiles">Refresh files</button>
    </div>
    <form class="space-y-3 rounded-lg border p-4" @submit.prevent="upload">
      <label :for="`${id}-file`" class="block font-medium">Choose a file</label>
      <input
        :id="`${id}-file`"
        ref="input"
        type="file"
        :aria-describedby="`${id}-limit ${id}-selection`"
        :disabled="pending !== null"
        class="block max-w-full rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @change="chooseFile"
      >
      <p :id="`${id}-limit`" class="text-sm text-muted-foreground">Maximum size: {{ formatBytes(maxBytes) }}. Files are downloaded as attachments. Only metadata is previewed here.</p>
      <p :id="`${id}-selection`" class="break-all text-sm">{{ selection ? `Selected: ${selection.file.name} (${formatBytes(selection.file.size)})` : 'No file selected.' }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="submit" :class="buttonClass" :disabled="!selection || pending !== null">{{ retry ? 'Retry upload' : 'Upload file' }}</button>
        <button v-if="pending === 'upload' || pending === 'cancel'" type="button" :class="buttonClass" :disabled="pending === 'cancel'" @click="cancelUpload">{{ pending === 'cancel' ? 'Cancelling…' : 'Cancel upload' }}</button>
        <button type="button" :class="buttonClass" :disabled="!selection || pending !== null" @click="clearSelection">Clear selection</button>
      </div>
    </form>
    <output aria-live="polite" aria-atomic="true" class="block text-sm">{{ status }}</output>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <div class="overflow-x-auto rounded-lg border" :aria-busy="loading">
      <table class="w-full text-left text-sm">
        <caption class="sr-only">{{ label }}</caption>
        <thead><tr class="border-b"><th v-for="heading in ['Name', 'Size', 'Status', 'Actions']" :key="heading" scope="col" class="px-4 py-3">{{ heading }}</th></tr></thead>
        <tbody>
          <tr v-for="{ file, url } in rows" :key="file.id" :data-file-state="file.state" class="border-b last:border-0">
            <th scope="row" class="max-w-72 break-all px-4 py-3 font-medium">{{ file.name }}</th>
            <td class="whitespace-nowrap px-4 py-3">{{ formatBytes(file.size) }}</td>
            <td class="px-4 py-3">{{ stateLabels[file.state] }}</td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap items-start gap-2">
                <a v-if="url" :class="buttonClass" :href="url" :download="file.name" :aria-label="`Download ${file.name}`">Download</a>
                <span v-else-if="file.state === 'ready'">Download unavailable</span>
                <button v-if="file.state !== 'removed'" type="button" :class="buttonClass" :disabled="pending !== null" :aria-label="`${file.state === 'cleanup-pending' ? 'Retry removal of' : 'Remove'} ${file.name}`" @click="remove(file)">{{ file.state === 'cleanup-pending' ? 'Retry removal' : 'Remove' }}</button>
                <details class="max-w-72 break-all">
                  <summary class="cursor-pointer rounded-md px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :aria-label="`Details for ${file.name}`">Details</summary>
                  <dl class="space-y-1 py-2">
                    <dt class="font-medium">File name</dt><dd>{{ file.name }}</dd>
                    <dt class="font-medium">Media type</dt><dd>{{ file.type || 'Not provided' }}</dd>
                    <dt class="font-medium">Size in bytes</dt><dd>{{ file.size }}</dd>
                  </dl>
                </details>
              </div>
            </td>
          </tr>
          <tr v-if="files.length === 0"><td colspan="4" class="px-4 py-6 text-muted-foreground">{{ loading ? 'Loading files…' : 'No files to display.' }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
