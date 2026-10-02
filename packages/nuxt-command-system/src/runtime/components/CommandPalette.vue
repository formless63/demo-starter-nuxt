<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import type { AppCommand } from '../index'

const props = withDefaults(defineProps<{
  commands: readonly AppCommand[]
  open?: boolean
  label?: string
  triggerLabel?: string
  shortcut?: boolean
}>(), { open: undefined, label: 'Command menu', triggerLabel: 'Open command menu', shortcut: true })
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const localOpen = ref(false)
const open = computed(() => props.open ?? localOpen.value)
const query = ref('')
const active = ref(0)
const pending = ref<string | null>(null)
const error = ref<string | null>(null)
const input = ref<HTMLInputElement>()
const id = useId()
const filtered = computed(() => props.commands.filter(command => !command.disabled && [command.label, ...(command.keywords ?? [])].some(value => value.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))))
// Presentation invalidation never releases the execution mutex. A dismissed
// command can still be running, and must settle before another execution starts.
let generation = 0
let running = false
let mounted = false
function setOpen(value: boolean) {
  if (value !== open.value) generation++
  if (props.open === undefined) localOpen.value = value
  emit('update:open', value)
}
watch(open, async (value) => {
  generation++
  error.value = null
  if (value) {
    query.value = ''
    active.value = 0
    await nextTick()
    input.value?.focus()
  }
}, { flush: 'sync' })
watch(filtered, () => { active.value = 0 }, { flush: 'sync' })
async function run(command: AppCommand) {
  if (running || !open.value || command.disabled || !props.commands.includes(command)) return
  running = true
  const token = ++generation
  pending.value = command.id
  error.value = null
  try {
    await command.execute()
    if (mounted && token === generation) setOpen(false)
  }
  catch (cause) {
    if (mounted && token === generation) error.value = cause instanceof Error ? cause.message : 'Command failed'
  }
  finally {
    running = false
    if (mounted) pending.value = null
  }
}
function navigate(event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = filtered.value.length
    active.value = count ? (active.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count : 0
  }
  if (event.key === 'Enter' && event.target === input.value) {
    event.preventDefault()
    const command = filtered.value[active.value]
    if (command) void run(command)
  }
}
function handleShortcut(event: KeyboardEvent) {
  const target = event.target
  if (!props.shortcut || event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
  if (target instanceof HTMLElement && (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || target.isContentEditable)) return
  event.preventDefault()
  setOpen(true)
}
onMounted(() => { mounted = true; window.addEventListener('keydown', handleShortcut) })
onBeforeUnmount(() => { mounted = false; generation++; window.removeEventListener('keydown', handleShortcut) })
</script>

<template>
  <DialogRoot :open="open" @update:open="setOpen">
    <DialogTrigger><slot name="trigger">{{ triggerLabel }}</slot></DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="command-overlay" />
      <DialogContent class="command-content" @keydown="navigate">
        <DialogTitle>{{ label }}</DialogTitle>
        <DialogDescription>Search and run an application command.</DialogDescription>
        <input
          ref="input" v-model="query" role="combobox" aria-label="Search commands"
          aria-autocomplete="list" :aria-controls="`${id}-options`" :aria-expanded="open"
          :aria-activedescendant="filtered[active] ? `${id}-option-${active}` : undefined"
          placeholder="Type a command…"
        >
        <div :id="`${id}-options`" role="listbox" :aria-label="label" :aria-busy="pending !== null">
          <button
            v-for="(command, index) in filtered" :id="`${id}-option-${index}`" :key="command.id"
            type="button" role="option" :aria-selected="active === index" :disabled="pending !== null"
            @mouseenter="active = index" @focus="active = index" @click="run(command)"
          >{{ command.label }}{{ pending === command.id ? ' (Running…)' : '' }}</button>
          <p v-if="!filtered.length" role="status">No commands found.</p>
        </div>
        <p v-if="pending" role="status">Running command…</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <DialogClose>Close</DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.command-overlay { position: fixed; inset: 0; background: #0006; z-index: 1000; }
.command-content { position: fixed; top: 20%; left: 50%; transform: translateX(-50%); width: min(32rem, calc(100vw - 2rem)); max-height: 70vh; overflow: auto; padding: 1rem; border: 1px solid #888; border-radius: .75rem; background: Canvas; color: CanvasText; z-index: 1001; }
.command-content input { width: 100%; box-sizing: border-box; padding: .75rem; }
.command-content [role="option"] { display: block; width: 100%; text-align: left; padding: .75rem; }
.command-content [aria-selected="true"] { outline: 2px solid Highlight; outline-offset: -2px; }
</style>
