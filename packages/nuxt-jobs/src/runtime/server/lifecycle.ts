import { createJobsBoss } from './boss'
import { defineQueues } from './client'
import type { JobRegistry, JobsRuntimeConfig } from './types'

export function createJobsClient(registry: JobRegistry, configuration: () => JobsRuntimeConfig,
  onError: (error: unknown) => void = error => console.error('[jobs] pg-boss error', error)) {
  let clientPromise: Promise<ReturnType<typeof createJobsBoss>> | undefined
  let stopPromise: Promise<void> | undefined

  async function start() {
    const boss = createJobsBoss(configuration(), 'producer')
    boss.on('error', onError)
    try {
      await boss.start()
      await defineQueues(boss, registry)
      return boss
    }
    catch (error) {
      await boss.stop({ graceful: false })
      throw error
    }
  }

  function use(): Promise<ReturnType<typeof createJobsBoss>> {
    if (stopPromise) return stopPromise.then(use)
    clientPromise ??= start().catch((error) => {
      clientPromise = undefined
      throw error
    })
    return clientPromise
  }

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise
    const starting = clientPromise
    if (!starting) return Promise.resolve()
    clientPromise = undefined
    stopPromise = (async () => {
      const boss = await starting.catch(() => undefined)
      await boss?.stop({ graceful: true, timeout: 30_000 })
    })().finally(() => { stopPromise = undefined })
    return stopPromise
  }

  return { use, stop }
}
