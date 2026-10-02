import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import FlowCanvas from '../../packages/nuxt-flow-canvas/src/runtime/components/FlowCanvas.vue'
import type { GraphDocument } from '../../packages/nuxt-flow-canvas/src/runtime/graph'

// This test isolates semantic controls. The actual Vue Flow renderer is exercised
// separately by the mandatory packed and reference real-browser contract.
vi.mock('../../packages/nuxt-flow-canvas/src/runtime/components/FlowSurface.vue', () => ({ __esModule: true, default: defineComponent({ render: () => h('div', { 'data-test-surface': '' }) }) }))
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()) })
const initial = (): GraphDocument => ({ schemaVersion: 1, nodes: [{ id: 'a', kind: 'default', position: { x: 0, y: 0 }, label: 'Alpha' }, { id: 'b', kind: 'default', position: { x: 50, y: 0 }, label: 'Beta' }], edges: [{ id: 'ab', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' }] })
async function settle() { await nextTick(); await Promise.resolve(); await nextTick() }
function mount() {
  const graph = ref(initial()); const accept = ref(false); const readOnly = ref(false); const key = ref('one')
  const proposals: GraphDocument[] = []
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ setup: () => () => h(FlowCanvas, { modelValue: graph.value, documentKey: key.value, readOnly: readOnly.value, 'onUpdate:modelValue': (next: GraphDocument) => { proposals.push(next); if (accept.value) graph.value = next } }) })
  app.mount(host); cleanup.push(() => { app.unmount(); host.remove() })
  return { host, graph, accept, readOnly, key, proposals }
}
function button(host: HTMLElement, label: string) { const value = [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label); if (!value) throw new Error(`Missing ${label}`); return value }
function submit(host: HTMLElement, name: string) { host.querySelector(`form[aria-label="${name}"]`)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }

describe('Flow semantic controlled UI', () => {
  it('proposes atomic removal, preserves rejected state, and restores focus for acceptance', async () => {
    const state = mount(); await settle()
    button(state.host, 'Delete node a').click(); await settle()
    expect(state.graph.value.nodes).toHaveLength(2)
    expect(state.graph.value.edges).toHaveLength(1)
    expect(state.proposals.at(-1)?.nodes.map(node => node.id)).toEqual(['b'])
    expect(state.proposals.at(-1)?.edges).toEqual([])
    state.accept.value = true
    button(state.host, 'Delete node a').click(); await settle()
    expect(state.graph.value.nodes).toHaveLength(1)
    expect(state.graph.value.edges).toHaveLength(0)
    expect(document.activeElement).toBe(button(state.host, 'Add node'))
  })
  it('read-only guards programmatic form dispatch and record switches discard edits', async () => {
    const state = mount(); await settle()
    button(state.host, 'Edit node a').click(); await settle()
    expect(state.host.querySelector('form[aria-label="Edit node"]')).not.toBeNull()
    state.key.value = 'two'; await settle()
    expect(state.host.querySelector('form[aria-label="Edit node"]')).toBeNull()
    state.readOnly.value = true; await settle()
    submit(state.host, 'Add node'); submit(state.host, 'Connect nodes'); await settle()
    expect(state.proposals).toEqual([])
    expect(button(state.host, 'Delete node a').disabled).toBe(true)
  })
  it('Escape cancels without proposing; text Delete is not intercepted', async () => {
    const state = mount(); await settle()
    button(state.host, 'Edit node a').click(); await settle()
    const input = state.host.querySelector<HTMLInputElement>('[data-edit-label]')!
    const deletion = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    input.dispatchEvent(deletion); expect(deletion.defaultPrevented).toBe(false)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle()
    expect(state.proposals).toEqual([])
    expect(state.host.querySelector('form[aria-label="Edit node"]')).toBeNull()
    expect(document.activeElement).toBe(button(state.host, 'Add node'))
  })
})
