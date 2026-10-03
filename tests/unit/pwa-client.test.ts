// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPwaController } from '../../packages/nuxt-pwa-offline/src/runtime/client'

function platform(base = '/') {
  const target = Object.assign(new EventTarget(), { isSecureContext: true })
  const active = Object.assign(new EventTarget(), { scriptURL: `https://example.test${base}pwa-offline-sw.js`, state: 'activated' })
  const registration = Object.assign(new EventTarget(), { scope: `https://example.test${base}`, active, waiting: null, installing: null, update: vi.fn(async () => {}) })
  const serviceWorker = { getRegistrations: vi.fn(async () => [] as unknown[]), controller: null, register: vi.fn(async () => registration) }
  const navigator = { serviceWorker, onLine: true, userActivation: { isActive: false } }
  vi.stubGlobal('window', target)
  vi.stubGlobal('location', { origin: 'https://example.test' })
  vi.stubGlobal('navigator', navigator)
  return { target, registration, serviceWorker, navigator }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('PWA browser controller lifecycle', () => {
  it('keeps SSR initial state independent and registration explicitly requested', async () => {
    const env = platform()
    const first = createPwaController()
    const second = createPwaController()
    const unsubscribe = first.subscribe(() => {})
    expect(env.serviceWorker.register).not.toHaveBeenCalled()
    expect(first.getServerSnapshot().status).toBe('idle')
    await Promise.all([first.register(), first.register()])
    expect(env.serviceWorker.register).toHaveBeenCalledTimes(1)
    expect(env.serviceWorker.register).toHaveBeenCalledWith('https://example.test/pwa-offline-sw.js', { scope: '/', updateViaCache: 'none' })
    expect(first.getSnapshot().status).toBe('ready')
    expect(second.getSnapshot().status).toBe('idle')
    expect(first.getServerSnapshot().status).toBe('idle')
    unsubscribe()
  })

  it('does not overwrite overlapping unrelated registrations or a foreign controller', async () => {
    for (const base of ['/', '/demo/']) {
      const env = platform(base)
      for (const existing of [
        { ...env.registration, active: { scriptURL: 'https://example.test/foreign-sw.js' } },
        { ...env.registration, scope: 'https://example.test/', active: { scriptURL: 'https://example.test/foreign-sw.js' } },
        { ...env.registration, scope: `https://example.test${base}nested/` },
      ]) {
        env.serviceWorker.getRegistrations.mockResolvedValue([existing])
        const controller = createPwaController({ base })
        const unsubscribe = controller.subscribe(() => {})
        await controller.register()
        expect(controller.getSnapshot().status).toBe('error')
        expect(env.serviceWorker.register).not.toHaveBeenCalled()
        unsubscribe()
      }
    }
  })

  it('removes listeners on last unmount and restores one set on remount', async () => {
    const env = platform()
    const add = vi.spyOn(env.target, 'addEventListener')
    const remove = vi.spyOn(env.target, 'removeEventListener')
    const controller = createPwaController()
    const first = controller.subscribe(() => {})
    const second = controller.subscribe(() => {})
    expect(add).toHaveBeenCalledTimes(4)
    await controller.register()
    first()
    expect(remove).not.toHaveBeenCalled()
    second()
    expect(remove).toHaveBeenCalledTimes(4)
    const remounted = controller.subscribe(() => {})
    expect(add).toHaveBeenCalledTimes(8)
    env.navigator.onLine = false
    env.target.dispatchEvent(new Event('offline'))
    expect(controller.getSnapshot().online).toBe(false)
    remounted()
    env.navigator.onLine = true
    env.target.dispatchEvent(new Event('online'))
    expect(controller.getSnapshot().online).toBe(false)
  })

  it('never treats synthetic browser events as real install eligibility or installation', async () => {
    const env = platform()
    const controller = createPwaController()
    const unsubscribe = controller.subscribe(() => {})
    env.target.dispatchEvent(new Event('beforeinstallprompt'))
    env.target.dispatchEvent(new Event('appinstalled'))
    expect(controller.getSnapshot().canInstall).toBe(false)
    expect(controller.getSnapshot().installed).toBe(false)
    await controller.install()
    expect(controller.getSnapshot().installed).toBe(false)
    unsubscribe()
  })

  it('leaves state and tabs untouched when deferring a waiting update', async () => {
    const env = platform()
    const waiting = { scriptURL: 'https://example.test/pwa-offline-sw.js', postMessage: vi.fn() }
    Object.assign(env.registration, { waiting })
    const controller = createPwaController()
    const unsubscribe = controller.subscribe(() => {})
    await controller.register()
    expect(controller.getSnapshot().status).toBe('waiting')
    controller.later()
    expect(controller.getSnapshot().status).toBe('waiting')
    expect(controller.getSnapshot().message).toBe('')
    expect(waiting.postMessage).not.toHaveBeenCalled()
    await controller.checkUpdate()
    expect(env.registration.update).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('never registers in retired or unsupported environments and rejects invalid bases', async () => {
    const env = platform()
    const retired = createPwaController({ base: '/', retired: true })
    await retired.register()
    expect(env.serviceWorker.register).not.toHaveBeenCalled()
    env.target.isSecureContext = false
    const unsupported = createPwaController()
    const unsubscribe = unsupported.subscribe(() => {})
    expect(unsupported.getSnapshot().status).toBe('unsupported')
    await unsupported.register()
    expect(env.serviceWorker.register).not.toHaveBeenCalled()
    expect(() => createPwaController({ base: '//elsewhere/' })).toThrow('Invalid PWA base')
    unsubscribe()
  })
})

it('requires a real install event plus user activation and ignores completion after unmount', async () => {
  const env = platform()
  const listeners = vi.spyOn(env.target, 'addEventListener')
  const controller = createPwaController()
  const unsubscribe = controller.subscribe(() => {})
  const installHandler = listeners.mock.calls.find(([name]) => name === 'beforeinstallprompt')?.[1] as EventListener
  let finishChoice: ((result: { outcome: 'accepted' }) => void) | undefined
  const prompt = vi.fn(async () => {})
  const trustedBrowserEvent = {
    isTrusted: true,
    preventDefault: vi.fn(),
    prompt,
    userChoice: new Promise<{ outcome: 'accepted' }>(resolve => { finishChoice = resolve }),
  }
  // Invoke the captured platform callback as a trusted browser, never create a
  // synthetic DOM event and pretend it establishes actual install eligibility.
  installHandler(trustedBrowserEvent as unknown as Event)
  expect(controller.getSnapshot().canInstall).toBe(true)
  await controller.install()
  expect(prompt).not.toHaveBeenCalled()
  env.navigator.userActivation.isActive = true
  const pending = controller.install()
  expect(prompt).toHaveBeenCalledTimes(1)
  unsubscribe()
  const remount = controller.subscribe(() => {})
  finishChoice?.({ outcome: 'accepted' })
  await pending
  expect(controller.getSnapshot().message).not.toContain('accepted')
  expect(controller.getSnapshot().installed).toBe(false)
  expect(controller.getSnapshot().canInstall).toBe(false)
  remount()
})

it('rejects a foreign controlling worker even without an overlapping registration', async () => {
  const env = platform()
  Object.assign(env.serviceWorker, { controller: { scriptURL: 'https://example.test/unrelated.js' } })
  const controller = createPwaController()
  const unsubscribe = controller.subscribe(() => {})
  await controller.register()
  expect(controller.getSnapshot().status).toBe('error')
  expect(env.serviceWorker.register).not.toHaveBeenCalled()
  unsubscribe()
})
