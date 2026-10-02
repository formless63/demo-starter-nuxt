<script setup lang="ts">
import { createCommandRegistry } from '@repo/nuxt-command-system/runtime'

const registry = createCommandRegistry([
  { id: 'home', label: 'Go to home', keywords: ['start'], execute: async () => { await navigateTo('/') } },
  { id: 'projects', label: 'Open projects', keywords: ['work'], execute: async () => { await navigateTo('/app/projects') } },
])
const { commands } = registry
</script>

<template>
  <main class="mx-auto max-w-2xl space-y-4 p-6">
    <h1 class="text-2xl font-semibold">Command System</h1>
    <p>Open the palette with the button or Control/Command+K. Search with the keyboard, select with arrows, and run with Enter.</p>
    <CommandPalette :commands="commands" />
  </main>
</template>
