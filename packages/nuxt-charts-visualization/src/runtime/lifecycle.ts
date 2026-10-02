export interface ChartsLifecycleDeps<Chart, Host, Option> {
  load: () => Promise<{ init: (host: Host) => Chart }>
  host: () => Host | null
  option: () => Option
  nextTick: () => Promise<void>
  setOption: (chart: Chart, option: Option) => void
  observe: (host: Host, onResize: () => void) => { disconnect: () => void }
  resize?: (chart: Chart) => void
  dispose: (chart: Chart) => void
  onStage?: (stage: string) => void
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
    deps.onStage?.('lifecycle-start')
    active = true
    const currentGeneration = ++generation
    await deps.nextTick()
    if (!active || generation !== currentGeneration) return
    const host = deps.host()
    if (!host) { deps.onStage?.('host-missing'); return }
    deps.onStage?.(`host-ready:${String((host as { clientWidth?: number }).clientWidth ?? 0)}x${String((host as { clientHeight?: number }).clientHeight ?? 0)}`)
    const loaded = await deps.load()
    if (!active || generation !== currentGeneration || !deps.host()) return
    chart = loaded.init(host)
    deps.onStage?.('echarts-init')
    await render()
    if (!active || generation !== currentGeneration || !chart) {
      if (chart) deps.dispose(chart)
      chart = undefined
      return
    }
    observer = deps.observe(host, () => { if (chart && deps.resize) deps.resize(chart) })
    deps.onStage?.('complete')
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
