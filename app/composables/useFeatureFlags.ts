import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useOrganizationTransition } from './useOrganizationTransition'

/** Fixed product defaults. Invalidate before selection writes; resume after authoritative reconciliation. */
export function useFeatureFlags(account: () => string | null) {
  const betaDashboard = ref(false)
  const transition = useOrganizationTransition()
  let generation = 0
  let mounted = false
  let controller: AbortController | undefined
  function invalidate() {
    generation++
    controller?.abort()
    controller = undefined
    betaDashboard.value = false
  }
  async function refresh() {
    invalidate()
    if (transition.state.value.pending || !account()) return
    const requestGeneration = generation
    controller = new AbortController()
    try {
      const values = await $fetch<Record<string, boolean>>('/api/feature-flags', { signal: controller.signal })
      if (requestGeneration === generation && !transition.state.value.pending) betaDashboard.value = values['beta.dashboard'] === true
    }
    catch { if (requestGeneration === generation) betaDashboard.value = false }
  }
  watch(transition.state, () => {
    invalidate()
    if (mounted && !transition.state.value.pending) void refresh()
  }, { flush: 'sync' })
  watch(account, () => {
    invalidate()
    if (mounted && !transition.state.value.pending && account()) void refresh()
  }, { flush: 'sync' })
  onMounted(() => { mounted = true; if (!transition.state.value.pending) void refresh() })
  onBeforeUnmount(() => { mounted = false; invalidate() })
  return { betaDashboard }
}
