export interface ChartsLifecycleDeps<Chart, Host, Option> {
  load: () => Promise<{ init: (host: Host) => Chart }>
  host: () => Host | null
  option: () => Option
  nextTick: () => Promise<void>
  setOption: (chart: Chart, option: Option) => void
  observe: (host: Host, onResize: () => void) => { disconnect: () => void }
  resize?: (chart: Chart) => void
  dispose: (chart: Chart) => void
}

export function createChartsLifecycle<Chart, Host, Option>(deps: ChartsLifecycleDeps<Chart, Host, Option>) {
  let active = true
  let generation = 0
  let chart: Chart | undefined
  let observer: { disconnect: () => void } | undefined

  const render = async () => {
    const current = chart
    const currentGeneration = generation
    if (!active || !current) return
    await deps.nextTick()
    if (active && generation === currentGeneration && chart === current) deps.setOption(current, deps.option())
  }

  const mount = async () => {
    active = true
    const currentGeneration = ++generation
    const host = deps.host()
    if (!host) return
    const loaded = await deps.load()
    if (!active || generation !== currentGeneration || !deps.host()) return
    chart = loaded.init(host)
    await render()
    if (!active || generation !== currentGeneration || !chart) {
      if (chart) deps.dispose(chart)
      chart = undefined
      return
    }
    observer = deps.observe(host, () => { if (chart && deps.resize) deps.resize(chart) })
  }

  const unmount = () => {
    active = false
    generation++
    observer?.disconnect()
    observer = undefined
    if (chart) deps.dispose(chart)
    chart = undefined
  }

  return { mount, unmount, render, get chart() { return chart } }
}
