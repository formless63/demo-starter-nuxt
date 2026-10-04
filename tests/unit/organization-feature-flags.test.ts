import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { organizationTransition } from '../../app/utils/organization-transition'
import { useFeatureFlags } from '../../app/composables/useFeatureFlags'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
// Nuxt auto-imports this lexical binding; no optional test-utils DOM barrel is needed.
vi.mock('#build/fetch.mjs', () => ({ $fetch: fetchMock }))
const state = ref({ generation: 0, pending: false, mutating: false })
vi.mock('../../app/composables/useOrganizationTransition', () => ({ useOrganizationTransition: () => ({ state }) }))
afterEach(() => { fetchMock.mockReset() })

// Synthetic promises only. No browser/server/DB fault injection or acceptance fixture imports.
describe('organization transition generations', () => {
  it('serializes writes and keeps failed reconciliation locked until explicit completion', () => {
    const value = { value: { generation: 0, pending: false, mutating: false } }
    const transition = organizationTransition(value)
    const first = transition.begin()!
    expect(transition.begin()).toBeUndefined()
    transition.complete(first)
    expect(value.value.pending).toBe(true)
    transition.settled(first)
    expect(value.value).toEqual({ generation: first, pending: true, mutating: false })
    expect(transition.begin()).toBeUndefined()
    transition.complete(first)
    const second = transition.begin()!
    transition.complete(first)
    expect(value.value).toEqual({ generation: second, pending: true, mutating: true })
    transition.settled(second)
    transition.complete(second)
    expect(value.value).toEqual({ generation: second, pending: false, mutating: false })
  })
})

describe('flag invalidation before organization selection', () => {
  it('clears immediately, ignores earlier results, and resumes only after reconciliation', async () => {
    state.value = { generation: 0, pending: false, mutating: false }
    const requests: Array<{ resolve: (value: Record<string, boolean>) => void, signal: AbortSignal }> = []
    fetchMock.mockImplementation((_path: string, options: { signal: AbortSignal }) => new Promise<Record<string, boolean>>(resolve => requests.push({ resolve, signal: options.signal })))
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({ setup() { const flags = useFeatureFlags(() => 'account-a'); return () => h('span', String(flags.betaDashboard.value)) } })
    try {
      app.mount(host)
      expect(requests).toHaveLength(1)
      state.value = { generation: 1, pending: true, mutating: true }
      expect(requests[0]!.signal.aborted).toBe(true)
      requests[0]!.resolve({ 'beta.dashboard': true })
      await Promise.resolve(); await nextTick()
      expect(host.textContent).toBe('false')
      expect(requests).toHaveLength(1)
      state.value = { generation: 1, pending: false, mutating: false }
      expect(requests).toHaveLength(2)
      requests[1]!.resolve({ 'beta.dashboard': true })
      await Promise.resolve(); await nextTick()
      expect(host.textContent).toBe('true')
      state.value = { generation: 2, pending: true, mutating: true }
      await nextTick()
      expect(host.textContent).toBe('false')
      expect(requests).toHaveLength(2)
    }
    finally { app.unmount(); host.remove() }
  })
  it('does not fetch when mounted during an unsettled selection', async () => {
    state.value = { generation: 3, pending: true, mutating: true }
    const fetch = fetchMock.mockResolvedValue({ 'beta.dashboard': false })
    const host = document.createElement('div')
    const app = createApp({ setup() { const flags = useFeatureFlags(() => 'account-a'); return () => h('span', String(flags.betaDashboard.value)) } })
    try {
      app.mount(host)
      expect(fetch).not.toHaveBeenCalled()
      state.value = { generation: 3, pending: false, mutating: false }
      await Promise.resolve(); await nextTick()
      expect(fetch).toHaveBeenCalledOnce()
      expect(host.textContent).toBe('false')
    }
    finally { app.unmount() }
  })
})


it('invalidates immediately when the authenticated account changes', async () => {
  state.value = { generation: 0, pending: false, mutating: false }
  const account = ref<string | null>('a')
  const requests: Array<(value: Record<string, boolean>) => void> = []
  fetchMock.mockImplementation(() => new Promise<Record<string, boolean>>(resolve => requests.push(resolve)))
  const host = document.createElement('div')
  const app = createApp({ setup() { const flags = useFeatureFlags(() => account.value); return () => h('span', String(flags.betaDashboard.value)) } })
  try {
    app.mount(host)
    account.value = 'b'
    requests[0]!({ 'beta.dashboard': true })
    await Promise.resolve(); await nextTick()
    expect(host.textContent).toBe('false')
    expect(requests).toHaveLength(2)
    requests[1]!({ 'beta.dashboard': true })
    await Promise.resolve(); await nextTick()
    expect(host.textContent).toBe('true')
    account.value = null
    await nextTick()
    expect(host.textContent).toBe('false')
    expect(requests).toHaveLength(2)
  }
  finally { app.unmount() }
})
