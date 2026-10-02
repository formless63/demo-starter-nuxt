import { computed, shallowRef } from 'vue'

export interface AppCommand {
  id: string
  label: string
  keywords?: readonly string[]
  disabled?: boolean
  execute: () => void | Promise<void>
}

/** Create per application/component scope, never a server module-level singleton. */
export function createCommandRegistry(initial: readonly AppCommand[] = []) {
  const entries = new Map(initial.map(command => [command.id, { command, token: Symbol(command.id) }]))
  const snapshot = shallowRef<readonly AppCommand[]>([...entries.values()].map(entry => entry.command))
  const refresh = () => { snapshot.value = [...entries.values()].map(entry => entry.command) }
  return {
    commands: computed(() => snapshot.value),
    list: () => snapshot.value,
    register(command: AppCommand) {
      const token = Symbol(command.id)
      entries.set(command.id, { command, token })
      refresh()
      return () => {
        if (entries.get(command.id)?.token !== token) return
        entries.delete(command.id)
        refresh()
      }
    },
  }
}
