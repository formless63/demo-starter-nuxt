<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { parseGraph, serializeGraph, validateGraph } from '@repo/nuxt-flow-canvas/graph'
import type { ConnectionPolicy, GraphDocument } from '@repo/nuxt-flow-canvas/graph'

function initial(): GraphDocument { return { schemaVersion: 1, nodes: [
  { id: 'alpha', kind: 'default', position: { x: 30, y: 50 }, label: 'Alpha café 🧭' },
  { id: 'beta', kind: 'default', position: { x: 300, y: 180 }, label: 'Beta' },
], edges: [] } }
const { data: loaded } = await useFetch<GraphDocument>('/api/flow-reference')
const graph = ref(validateGraph(loaded.value ?? initial()))
const second = ref(initial())
const record = ref('record-a')
const readOnly = ref(false)
const reject = ref(false)
const rejectConnections = ref(false)
const failSave = ref(false)
const showEditor = ref(true)
const dirty = ref(false)
const proposals = ref(0)
const status = ref('No persistence requested.')
const json = ref('')
const persisted = new Map<string, GraphDocument>()
let revision = 0
let sequence = 0
let controller: AbortController | undefined
let alive = true
const policy: ConnectionPolicy = () => !rejectConnections.value
function accept(next: GraphDocument) {
  proposals.value++
  if (readOnly.value || reject.value) return
  graph.value = validateGraph(next); revision++; dirty.value = true
}
function cancel(message = 'Persistence cancelled.') { sequence++; controller?.abort(); controller = undefined; status.value = message }
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, rejectPromise) => {
    const timer = setTimeout(resolve, 1000)
    signal.addEventListener('abort', () => { clearTimeout(timer); rejectPromise(new Error('Cancelled')) }, { once: true })
  })
}
async function persist(mode: 'save' | 'load') {
  if (readOnly.value || !showEditor.value) return
  cancel()
  const request = ++sequence
  const requestRevision = revision
  const key = record.value
  const value = validateGraph(graph.value)
  const fail = failSave.value
  controller = new AbortController()
  const signal = controller.signal
  status.value = mode === 'save' ? 'Saving…' : 'Loading…'
  const current = () => alive && !signal.aborted && request === sequence && record.value === key && revision === requestRevision && !readOnly.value && showEditor.value
  try {
    await pause(signal)
    if (!current()) { if (request === sequence) status.value = 'Stale completion ignored; newer edits preserved.'; return }
    if (fail && mode === 'save') throw new Error('Synthetic failure')
    if (mode === 'save') { persisted.set(key, value); dirty.value = false; status.value = 'Saved by the reference application.' }
    else { graph.value = validateGraph(persisted.get(key) ?? initial()); revision++; dirty.value = false; status.value = 'Loaded by the reference application.' }
  }
  catch { if (current()) status.value = 'Save failed. Unsaved edits preserved.' }
  finally { if (request === sequence) controller = undefined }
}
function switchRecord() { cancel('Record changed.'); record.value = record.value === 'record-a' ? 'record-b' : 'record-a'; graph.value = initial(); revision++; dirty.value = false }
function importJson() {
  if (readOnly.value) return
  try { accept(parseGraph(json.value)); status.value = reject.value ? 'Import proposal rejected.' : 'Imported graph; not yet saved.' }
  catch { status.value = 'Invalid graph JSON. Current graph preserved.' }
}
function exportJson() { json.value = serializeGraph(graph.value); status.value = 'Graph exported to the text field.' }
function toggleEditor() { cancel('Editor toggled; pending persistence discarded.'); showEditor.value = !showEditor.value }
onBeforeUnmount(() => { alive = false; cancel() })
</script>

<template>
  <main>
    <h1>Flow canvas reference</h1>
    <p>Application-owned graph state and synthetic asynchronous persistence. No network, autosave, storage service, or workflow execution.</p>
    <p data-proposals :data-count="proposals">Proposals received: {{ proposals }}</p>
    <p data-record>Current record: {{ record }}</p><p data-dirty>{{ dirty ? 'Unsaved changes' : 'No unsaved changes' }}</p>
    <label><input v-model="readOnly" type="checkbox">Read only</label>
    <label><input v-model="reject" type="checkbox">Reject editor proposals</label>
    <label><input v-model="rejectConnections" type="checkbox">Reject connections by policy</label>
    <label><input v-model="failSave" type="checkbox">Fail next synthetic saves</label>
    <button type="button" @click="switchRecord">Switch record</button><button type="button" @click="toggleEditor">Toggle editor</button>
    <FlowCanvas v-if="showEditor" :model-value="graph" :document-key="record" :read-only="readOnly" :connection-policy="policy" title="Primary diagram" @update:model-value="accept" />
    <div aria-label="Persistence controls">
      <button type="button" :disabled="readOnly || !showEditor" @click="persist('save')">Save graph</button>
      <button type="button" :disabled="readOnly || !showEditor" @click="persist('load')">Load graph</button>
      <button type="button" @click="cancel()">Cancel persistence</button>
      <button type="button" @click="exportJson">Export JSON</button>
      <label for="graph-json">Graph JSON</label><textarea id="graph-json" v-model="json" :readonly="readOnly" />
      <button type="button" :disabled="readOnly" @click="importJson">Import JSON</button>
      <output data-persistence-status aria-live="polite">{{ status }}</output>
    </div>
    <FlowCanvas v-model="second" :document-key="record" title="Independent diagram" />
  </main>
</template>
