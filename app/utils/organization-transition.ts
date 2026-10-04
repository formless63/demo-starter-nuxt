export interface OrganizationTransitionState { generation: number, pending: boolean, mutating: boolean }

export function organizationTransition<T extends { value: OrganizationTransitionState }>(state: T) {
  function begin() {
    // Serialize selection-affecting writes across the switcher and every page.
    if (state.value.pending) return undefined
    const generation = state.value.generation + 1
    state.value = { generation, pending: true, mutating: true }
    return generation
  }
  function settled(generation: number) {
    if (state.value.generation === generation) state.value = { generation, pending: true, mutating: false }
  }
  function complete(generation: number) {
    if (state.value.generation === generation && !state.value.mutating) state.value = { generation, pending: false, mutating: false }
  }
  return { state, begin, settled, complete }
}
