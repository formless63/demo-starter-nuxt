/** Fixed product defaults. Personalized requests are aborted and generation-checked. */
export function useFeatureFlags() {
  const betaDashboard = ref(false)
  let generation = 0
  let controller: AbortController | undefined
  async function refresh() {
    const requestGeneration = ++generation
    controller?.abort()
    controller = new AbortController()
    betaDashboard.value = false
    try {
      const values = await $fetch<Record<string, boolean>>('/api/feature-flags', { signal: controller.signal })
      if (requestGeneration === generation) betaDashboard.value = values['beta.dashboard'] === true
    }
    catch { if (requestGeneration === generation) betaDashboard.value = false }
  }
  onMounted(() => { void refresh(); window.addEventListener('organization:changed', refresh) })
  onBeforeUnmount(() => { generation++; controller?.abort(); window.removeEventListener('organization:changed', refresh) })
  return { betaDashboard }
}
