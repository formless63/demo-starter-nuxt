import { describe, expect, it, vi } from 'vitest'
import { createChartsLifecycle } from '../../packages/nuxt-charts-visualization/src/runtime/lifecycle'

describe('charts lifecycle interruption', () => {
  it('does not initialize or observe after delayed load is unmounted, then remounts and disposes cleanly', async () => {
    let resolveLoader!: (value: { init: (host: object) => object }) => void
    const load = vi.fn(() => new Promise<{ init: (host: object) => object }>(resolve => { resolveLoader = resolve }))
    const init = vi.fn(() => ({}))
    const observe = vi.fn(() => ({ disconnect: vi.fn() }))
    const dispose = vi.fn()
    const controller = createChartsLifecycle({
      load, host: () => ({}), option: () => ({ value: 1 }), nextTick: async () => undefined,
      setOption: vi.fn(), observe, dispose,
    })
    const first = controller.mount()
    controller.unmount()
    resolveLoader({ init })
    await first
    expect(init).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()

    const secondLoad = Promise.resolve({ init })
    load.mockReturnValueOnce(secondLoad)
    await controller.mount()
    expect(init).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledTimes(1)
    const update = controller.render()
    controller.unmount()
    await update
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(observe.mock.results[0]?.value.disconnect).toHaveBeenCalledTimes(1)
  })

  it('applies a reduced-motion option change to the mounted instance', async () => {
    let animation = true
    const setOption = vi.fn()
    const controller = createChartsLifecycle({
      load: async () => ({ init: () => ({}) }), host: () => ({}), option: () => ({ animation }),
      nextTick: async () => undefined, setOption, observe: () => ({ disconnect: vi.fn() }), dispose: vi.fn(),
    })
    await controller.mount()
    animation = false
    await controller.render()
    expect(setOption).toHaveBeenLastCalledWith({}, { animation: false })
  })
})
