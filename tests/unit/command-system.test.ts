import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import CommandPalette from '../../packages/nuxt-command-system/src/runtime/components/CommandPalette.vue'
import { createCommandRegistry, type AppCommand } from '../../packages/nuxt-command-system/src/runtime/index'

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.innerHTML = '' })
async function flush() { await nextTick(); await new Promise(resolve => setTimeout(resolve, 20)); await nextTick() }
function mount(commands: AppCommand[]) {
  const open = ref(false)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup: () => () => h(CommandPalette, { commands, open: open.value, 'onUpdate:open': (value: boolean) => { open.value = value } }) })
  app.mount(root)
  cleanups.push(() => app.unmount())
  return { open, app }
}
function clickOption(name: string) {
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(element => element.textContent?.includes(name))
  expect(option).toBeTruthy()
  option!.click()
}

describe('Command System', () => {
  it('keeps registry ownership and request-local snapshots independent', () => {
    const registry = createCommandRegistry()
    const old = registry.register({ id: 'x', label: 'Old', execute() {} })
    const current = registry.register({ id: 'x', label: 'Current', execute() {} })
    old()
    expect(registry.commands.value[0]?.label).toBe('Current')
    expect(createCommandRegistry().commands.value).toEqual([])
    current(); current()
    expect(registry.commands.value).toEqual([])
  })
  it('supports uncontrolled opening, editable shortcut guards and empty results', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp({ setup: () => () => h(CommandPalette, { commands: [{ id: 'a', label: 'Alpha', execute() {} }] }) })
    app.mount(root)
    cleanups.push(() => app.unmount())
    const editable = document.createElement('input')
    document.body.append(editable)
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    root.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    await flush()
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
    expect(input).toBeTruthy()
    input.value = 'missing'; input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await flush()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    expect(document.body.textContent).toContain('No commands found.')
  })
  it('filters keywords/disabled commands and handles keyboard errors', async () => {
    const execute = vi.fn(() => { throw new Error('Expected failure') })
    const { open } = mount([{ id: 'a', label: 'Action', keywords: ['findme'], execute }, { id: 'b', label: 'Disabled', disabled: true, execute }])
    open.value = true
    await flush()
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
    input.value = 'findme'; input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Expected failure')
    expect(open.value).toBe(true)
  })
  it('does not release the mutex across controlled close/reopen or present stale completion', async () => {
    let finish!: () => void
    const execute = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const { open } = mount([{ id: 'slow', label: 'Slow', execute }])
    open.value = true; await flush(); clickOption('Slow'); await flush()
    open.value = false; await flush(); open.value = true; await flush()
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
    finish(); await flush()
    expect(open.value).toBe(true)
    clickOption('Slow'); await flush()
    expect(execute).toHaveBeenCalledTimes(2)
    finish(); await flush()
    expect(open.value).toBe(false)
  })
  it('suppresses stale rejections and consumes unmounted rejection', async () => {
    let reject!: (cause: Error) => void
    const execute = () => new Promise<void>((_resolve, fail) => { reject = fail })
    const { open, app } = mount([{ id: 'slow', label: 'Slow', execute }])
    open.value = true; await flush(); clickOption('Slow'); await flush()
    open.value = false; await flush(); open.value = true; await flush()
    reject(new Error('Stale')); await flush()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    clickOption('Slow'); await flush(); app.unmount(); cleanups.pop()
    reject(new Error('Unmounted')); await flush()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
