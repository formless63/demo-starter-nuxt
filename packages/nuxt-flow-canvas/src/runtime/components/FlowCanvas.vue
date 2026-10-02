<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { deleteGraphNode, proposeConnection, serializeGraph, validateGraph } from '../graph'
import type { ConnectionPolicy, GraphDocument } from '../graph'

const props = withDefaults(defineProps<{
  modelValue: GraphDocument
  documentKey: string
  readOnly?: boolean
  title?: string
  connectionPolicy?: ConnectionPolicy
}>(), { readOnly: false, title: 'Flow canvas', connectionPolicy: undefined })
const emit = defineEmits<{ 'update:modelValue': [graph: GraphDocument]; proposal: [graph: GraphDocument, documentKey: string] }>()
const Surface = defineAsyncComponent(() => import('./FlowSurface.vue'))
const graph = computed(() => validateGraph(props.modelValue))
const id = useId()
const headingId = `${id}-heading`
const enhanced = ref(false)
const generation = ref(0)
const notice = ref('')
const host = ref<HTMLElement>()
const label = ref('')
const source = ref('')
const target = ref('')
const editId = ref('')
const editLabel = ref('')
const editX = ref(0)
const editY = ref(0)
let alive = true
let expectedProposal: string | undefined
function announce(message: string) { notice.value = message }
function nextId(prefix: string) {
  const ids = new Set([...graph.value.nodes, ...graph.value.edges].map(item => item.id))
  let index = 1
  while (ids.has(`${prefix}-${index}`)) index++
  return `${prefix}-${index}`
}
function propose(value: GraphDocument, key = props.documentKey) {
  if (!alive || props.readOnly || key !== props.documentKey) return false
  try {
    const next = validateGraph(value)
    expectedProposal = serializeGraph(next)
    emit('update:modelValue', next)
    emit('proposal', next, key)
    announce('Change proposed. The application decides whether to accept it.')
    return true
  }
  catch { announce('Change rejected: invalid graph.'); return false }
}
function add() {
  if (propose({ ...graph.value, nodes: [...graph.value.nodes, { id: nextId('node'), kind: 'default', position: { x: 0, y: 0 }, label: label.value }] })) label.value = ''
}
function connect() {
  if (props.readOnly) return
  try { propose(proposeConnection(graph.value, { id: nextId('edge'), source: source.value, target: target.value, sourceHandle: 'out', targetHandle: 'in' }, props.connectionPolicy)) }
  catch { announce('Connection rejected. Choose two different unconnected nodes allowed by the application.') }
}
function focusAdd() { void nextTick(() => host.value?.querySelector<HTMLButtonElement>('[data-add-node]')?.focus()) }
function removeNode(nodeId: string) {
  if (propose(deleteGraphNode(graph.value, nodeId))) { editId.value = ''; focusAdd() }
}
function removeEdge(edgeId: string) { if (propose({ ...graph.value, edges: graph.value.edges.filter(edge => edge.id !== edgeId) })) focusAdd() }
function edit(nodeId: string) {
  if (props.readOnly) return
  const node = graph.value.nodes.find(node => node.id === nodeId)
  if (!node) return
  editId.value = node.id; editLabel.value = node.label; editX.value = node.position.x; editY.value = node.position.y
  void nextTick(() => host.value?.querySelector<HTMLInputElement>('[data-edit-label]')?.focus())
}
function applyEdit() {
  if (propose({ ...graph.value, nodes: graph.value.nodes.map(node => node.id === editId.value ? { ...node, label: editLabel.value, position: { x: Number(editX.value), y: Number(editY.value) } } : node) })) cancelEdit(false)
}
function cancelEdit(message = true) { editId.value = ''; generation.value++; if (message) announce('Editing cancelled.'); focusAdd() }
function escape(event: KeyboardEvent) {
  // Only Escape is handled, within this editor. Text inputs retain ordinary editing shortcuts.
  if (event.key !== 'Escape') return
  event.stopPropagation(); cancelEdit()
}
function reset() {
  editId.value = ''; label.value = ''; source.value = ''; target.value = ''; notice.value = ''; generation.value++
}
watch(() => props.modelValue, (value) => {
  const accepted = serializeGraph(value)
  if (accepted !== expectedProposal) {
    // A parent-originated replacement interrupts old pointer state before it can
    // overwrite newly loaded data or externally edited coordinates.
    editId.value = ''; generation.value++
  }
  expectedProposal = undefined
}, { deep: true, flush: 'sync' })
watch(() => props.documentKey, reset, { flush: 'sync' })
watch(() => props.readOnly, () => { editId.value = ''; generation.value++ })
onMounted(() => { enhanced.value = true })
onBeforeUnmount(() => { alive = false })
</script>

<template>
  <section ref="host" class="flow-canvas" :aria-labelledby="headingId" :data-document-key="documentKey" @keydown="escape">
    <h2 :id="headingId">{{ title }}</h2>
    <p v-if="readOnly">Read-only diagram.</p>
    <p v-else>Use the forms below to add, connect, rename, position, or delete nodes. Escape cancels editing and the current canvas interaction.</p>
    <Surface v-if="enhanced" :key="`${documentKey}:${generation}`" :graph="graph" :document-key="documentKey" :read-only="readOnly" :connection-policy="connectionPolicy" @proposal="propose" @notice="announce" @cancel="cancelEdit()" />
    <p v-else>Interactive canvas loads after hydration. The complete diagram is listed below.</p>
    <p data-accepted-viewport :data-zoom="graph.viewport?.zoom ?? 1">Viewport: x {{ graph.viewport?.x ?? 0 }}, y {{ graph.viewport?.y ?? 0 }}, zoom {{ graph.viewport?.zoom ?? 1 }}</p>
    <h3>Nodes</h3>
    <p v-if="!graph.nodes.length">No nodes.</p>
    <ul aria-label="Graph nodes">
      <li v-for="node in graph.nodes" :key="node.id" :data-node-id="node.id">
        <span>{{ node.label }} ({{ node.id }}), x {{ node.position.x }}, y {{ node.position.y }}</span>
        <button type="button" :disabled="readOnly" :aria-label="`Edit node ${node.id}`" @click="edit(node.id)">Edit</button>
        <button type="button" :disabled="readOnly" :aria-label="`Delete node ${node.id}`" @click="removeNode(node.id)">Delete</button>
      </li>
    </ul>
    <h3>Connections</h3>
    <p v-if="!graph.edges.length">No connections.</p>
    <ul aria-label="Graph connections">
      <li v-for="edge in graph.edges" :key="edge.id" :data-edge-id="edge.id">
        <span>{{ edge.source }} → {{ edge.target }}{{ edge.label ? `: ${edge.label}` : '' }}</span>
        <button type="button" :disabled="readOnly" :aria-label="`Delete connection ${edge.id}`" @click="removeEdge(edge.id)">Delete</button>
      </li>
    </ul>
    <form aria-label="Add node" @submit.prevent="add">
      <label :for="`${id}-label`">New node label</label><input :id="`${id}-label`" v-model="label" :disabled="readOnly" maxlength="1000">
      <button data-add-node type="submit" :disabled="readOnly">Add node</button>
    </form>
    <form aria-label="Connect nodes" @submit.prevent="connect">
      <label :for="`${id}-source`">Source node</label><select :id="`${id}-source`" v-model="source" :disabled="readOnly"><option value="">Choose source</option><option v-for="node in graph.nodes" :key="node.id" :value="node.id">{{ node.id }}: {{ node.label }}</option></select>
      <label :for="`${id}-target`">Target node</label><select :id="`${id}-target`" v-model="target" :disabled="readOnly"><option value="">Choose target</option><option v-for="node in graph.nodes" :key="node.id" :value="node.id">{{ node.id }}: {{ node.label }}</option></select>
      <button type="submit" :disabled="readOnly || !source || !target">Connect nodes</button>
    </form>
    <form v-if="editId && !readOnly" aria-label="Edit node" @submit.prevent="applyEdit">
      <label :for="`${id}-edit`">Node label</label><input :id="`${id}-edit`" v-model="editLabel" data-edit-label maxlength="1000">
      <label :for="`${id}-x`">X position</label><input :id="`${id}-x`" v-model="editX" type="number" min="-1000000" max="1000000" step="any" required>
      <label :for="`${id}-y`">Y position</label><input :id="`${id}-y`" v-model="editY" type="number" min="-1000000" max="1000000" step="any" required>
      <button type="submit">Apply node changes</button><button type="button" @click="cancelEdit()">Cancel editing</button>
    </form>
    <output aria-live="polite" role="status">{{ notice }}</output>
  </section>
</template>
