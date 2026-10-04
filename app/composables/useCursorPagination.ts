import { computed, ref, watch } from 'vue'

/** Cursor history belongs to one explicit resource scope, never the selected workspace. */
export function useCursorPagination(scope: () => string) {
  const cursor = ref<string>()
  const history = ref<Array<string | undefined>>([])
  function reset() { cursor.value = undefined; history.value = [] }
  watch(scope, reset, { flush: 'sync' })
  function next(value: string | null | undefined) {
    if (!value || value === cursor.value) return
    history.value = [...history.value, cursor.value]
    cursor.value = value
  }
  function previous() {
    if (!history.value.length) return
    cursor.value = history.value.at(-1)
    history.value = history.value.slice(0, -1)
  }
  return { cursor, page: computed(() => history.value.length + 1), next, previous, reset }
}
