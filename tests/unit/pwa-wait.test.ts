// @vitest-environment node
import { expect, it } from 'vitest'
import { waitForPwa } from '../../fixtures/pwa-offline-consumer/.fixture/wait'

it('awaits false, false, true instead of accepting an unresolved readiness Promise', async () => {
  const observations: boolean[] = []
  await waitForPwa(async () => {
    await Promise.resolve()
    const ready = observations.length >= 2
    observations.push(ready)
    return ready
  }, 'false async predicates are not readiness')
  expect(observations).toEqual([false, false, true])
})
