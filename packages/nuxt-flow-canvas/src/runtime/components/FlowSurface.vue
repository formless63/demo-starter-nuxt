<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Handle, Position, VueFlow, useVueFlow } from '@vue-flow/core'
import type { Connection, EdgeChange, NodeChange, ViewportTransform } from '@vue-flow/core'
import { deleteGraphNode, proposeConnection, validateGraph } from '../graph'
import type { ConnectionPolicy, GraphDocument } from '../graph'
import { flowVendorId } from '../vendor-id'

const props = defineProps<{ graph: GraphDocument; documentKey: string; readOnly: boolean; connectionPolicy?: ConnectionPolicy }>()
const emit = defineEmits<{ proposal: [graph: GraphDocument, key: string]; notice: [message: string]; cancel: [] }>()
// Never use an ambient/default store: two editors may contain identical IDs.
const storeId = `flow-${flowVendorId(useId())}`
const store = useVueFlow({ id: storeId, applyDefault: false })
const ready = ref(false)
let alive = true
let pointerActive = false
let viewportActive = false
function stopPointer() { pointerActive = false }
function cancelInteraction() {
  if (!alive || (!pointerActive && !viewportActive)) return
  pointerActive = false; viewportActive = false; emit('cancel')
}
function escapeInteraction(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (!pointerActive && !viewportActive)) return
  event.stopPropagation(); cancelInteraction()
}
onMounted(() => {
  document.addEventListener('keydown', escapeInteraction, true)
  document.addEventListener('pointerup', stopPointer)
  document.addEventListener('pointercancel', cancelInteraction)
  window.addEventListener('blur', cancelInteraction)
})
let restoringViewport = false
const nodes = computed(() => props.graph.nodes.map(node => ({ id: flowVendorId(node.id), type: 'safe', position: { ...node.position }, data: { label: node.label }, focusable: false })))
const edges = computed(() => props.graph.edges.map(edge => ({ ...edge, id: `${storeId}-${flowVendorId(edge.id)}`, source: flowVendorId(edge.source), target: flowVendorId(edge.target), type: 'default', focusable: false, updatable: false })))
const graphIds = computed(() => new Map([
  ...props.graph.nodes.map(item => [flowVendorId(item.id), item.id] as const),
  ...props.graph.edges.map(item => [`${storeId}-${flowVendorId(item.id)}`, item.id] as const),
]))
const viewport = computed(() => props.graph.viewport ?? { x: 0, y: 0, zoom: 1 })
function sameViewport(value: ViewportTransform) {
  const current = viewport.value
  return current.x === value.x && current.y === value.y && current.zoom === value.zoom
}
async function reconcile() {
  await nextTick()
  if (!alive) return
  // setNodes replaces the detached renderer projection, including rejected drag coordinates.
  store.setNodes(nodes.value)
  store.setEdges(edges.value)
  if (ready.value && !sameViewport(store.getViewport())) {
    restoringViewport = true
    try { await store.setViewport({ ...viewport.value }, { duration: 0 }) }
    finally { restoringViewport = false }
  }
}
function propose(graph: GraphDocument) {
  if (!alive || props.readOnly) return
  try { emit('proposal', validateGraph(graph), props.documentKey) }
  catch { emit('notice', 'Change rejected: invalid graph.') }
  void reconcile()
}
function onNodesChange(changes: NodeChange[]) {
  if (!alive) return
  // Measurement and selection are renderer-only state, never persisted graph fields.
  store.applyNodeChanges(changes.filter(change => change.type === 'dimensions' || change.type === 'select'))
  if (props.readOnly) { void reconcile(); return }
  let graph = validateGraph(props.graph)
  let changed = false
  for (const change of changes) {
    if (change.type === 'remove') {
      const id = graphIds.value.get(change.id)
      if (id) { graph = deleteGraphNode(graph, id); changed = true }
    }
    if (change.type === 'position' && change.position) {
      graph.nodes = graph.nodes.map(node => node.id === graphIds.value.get(change.id) ? { ...node, position: { x: change.position.x, y: change.position.y } } : node)
      changed = true
    }
  }
  if (changed) propose(graph)
}
function onEdgesChange(changes: EdgeChange[]) {
  if (!alive) return
  store.applyEdgeChanges(changes.filter(change => change.type === 'select'))
  if (props.readOnly) { void reconcile(); return }
  const removed = new Set(changes.filter(change => change.type === 'remove').map(change => graphIds.value.get(change.id)))
  if (removed.size) propose({ ...props.graph, edges: props.graph.edges.filter(edge => !removed.has(edge.id)) })
}
function onConnect(connection: Connection) {
  if (props.readOnly || !alive) return
  try {
    let index = 1
    const ids = new Set([...props.graph.nodes, ...props.graph.edges].map(item => item.id))
    while (ids.has(`edge-${index}`)) index++
    if (connection.sourceHandle !== 'out' || connection.targetHandle !== 'in') throw new Error('Invalid handles')
    propose(proposeConnection(props.graph, { id: `edge-${index}`, source: graphIds.value.get(connection.source) ?? '', target: graphIds.value.get(connection.target) ?? '', sourceHandle: 'out', targetHandle: 'in' }, props.connectionPolicy))
  }
  catch { emit('notice', 'Connection rejected. Choose two different unconnected nodes allowed by the application.') }
}
function onViewportChangeStart() {
  if (alive && ready.value && !restoringViewport) viewportActive = true
}
function onViewportChangeEnd(value: ViewportTransform) {
  viewportActive = false
  if (!alive || restoringViewport || sameViewport(value)) return
  if (!props.readOnly) propose({ ...props.graph, viewport: { x: value.x, y: value.y, zoom: value.zoom } })
  else void reconcile()
}
function onReady() { ready.value = true; void reconcile() }
watch(() => props.graph, () => void reconcile(), { deep: true })
onBeforeUnmount(() => {
  alive = false
  document.removeEventListener('keydown', escapeInteraction, true)
  document.removeEventListener('pointerup', stopPointer)
  document.removeEventListener('pointercancel', cancelInteraction)
  window.removeEventListener('blur', cancelInteraction)
})
</script>

<template>
  <div class="flow-surface" data-flow-surface :data-ready="ready" aria-label="Visual graph canvas" @pointerdown="pointerActive = true">
    <VueFlow
:id="storeId" :nodes="nodes" :edges="edges" :apply-default="false"
      :default-viewport="viewport" :min-zoom="0.1" :max-zoom="4" :nodes-draggable="!readOnly" :nodes-connectable="!readOnly"
      :edges-updatable="false" :elements-selectable="!readOnly" :nodes-focusable="false" :edges-focusable="false"
      :delete-key-code="null" :selection-key-code="null" :multi-selection-key-code="null" :pan-activation-key-code="null" :zoom-activation-key-code="null"
      :pan-on-drag="!readOnly" :zoom-on-scroll="!readOnly" :zoom-on-pinch="!readOnly" :zoom-on-double-click="false" :auto-pan-on-node-drag="false"
      @nodes-change="onNodesChange" @edges-change="onEdgesChange" @connect="onConnect" @viewport-change-start="onViewportChangeStart" @viewport-change-end="onViewportChangeEnd" @pane-ready="onReady">
      <template #node-safe="{ data }">
        <Handle id="in" type="target" :position="Position.Left" :connectable="!readOnly" />
        <span>{{ data.label }}</span>
        <Handle id="out" type="source" :position="Position.Right" :connectable="!readOnly" />
      </template>
    </VueFlow>
  </div>
</template>
