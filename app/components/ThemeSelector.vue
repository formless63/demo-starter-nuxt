<script setup lang="ts">
const colorMode = useColorMode()
</script>

<template>
  <label class="sr-only" for="theme">Theme</label>
  <select
    id="theme"
    v-model="colorMode.preference"
    class="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label="Theme"
  >
    <option value="light">Light</option>
    <option value="dark">Dark</option>
    <option value="system">System</option>
  </select>
</template>
