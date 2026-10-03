import { organizationTransition } from '../utils/organization-transition'

/** App/request-local state; no module-global identity or transition state. */
export function useOrganizationTransition() {
  const state = useState('organization-transition', () => ({ generation: 0, pending: false, mutating: false }))
  const transition = organizationTransition(state)
  async function reconcile(generation: number) {
    if (state.value.generation !== generation || state.value.mutating) return false
    await $fetch('/api/organizations/current')
    transition.complete(generation)
    return state.value.generation === generation && !state.value.pending
  }
  return { ...transition, reconcile }
}
