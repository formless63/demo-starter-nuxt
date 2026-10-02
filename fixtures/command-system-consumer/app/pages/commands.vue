<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { ref } from 'vue'
import { createCommandRegistry } from '@repo/nuxt-command-system/runtime'

const open = ref(false)
const count = ref(0)
const shown = ref(true)
const registry = createCommandRegistry([
  { id: 'increment', label: 'Increment counter', keywords: ['add'], execute: () => { count.value++ } },
  { id: 'slow', label: 'Slow counter', execute: async () => { count.value++; await new Promise(resolve => setTimeout(resolve, 1000)) } },
  { id: 'failure', label: 'Fail command', execute: () => { throw new Error('Expected command failure') } },
  { id: 'disabled', label: 'Disabled command', disabled: true, execute: () => { count.value += 100 } },
  { id: 'controlled', label: 'Controlled interrupt', execute: async () => {
    count.value++
    setTimeout(() => { open.value = false }, 30)
    setTimeout(() => { open.value = true }, 80)
    await new Promise(resolve => setTimeout(resolve, 1000))
  } },
  { id: 'late-failure', label: 'Late failure', execute: async () => {
    setTimeout(() => { open.value = false }, 30)
    setTimeout(() => { open.value = true }, 80)
    await new Promise(resolve => setTimeout(resolve, 700))
    throw new Error('Stale failure must not render')
  } },
  { id: 'unmount', label: 'Unmount palette', execute: async () => {
    shown.value = false
    await new Promise(resolve => setTimeout(resolve, 20))
    throw new Error('Unmounted failure')
  } },
])
const { commands } = registry
const cleanupOld = registry.register({ id: 'owned', label: 'Old registration', execute: () => {} })
const cleanupNew = registry.register({ id: 'owned', label: 'Replacement registration', execute: () => {} })
cleanupOld()
function removeReplacement() { cleanupNew() }
</script>

<template>
  <main>
    <h1>Command System consumer</h1>
    <p data-testid="counter">{{ count }}</p>
    <input aria-label="Ordinary text input">
    <div contenteditable="true" aria-label="Editable region">Edit here</div>
    <button @click="removeReplacement">Unregister replacement</button>
    <CommandPalette v-if="shown" v-model:open="open" :commands="commands" />
  </main>
</template>
