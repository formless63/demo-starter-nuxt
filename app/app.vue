<script setup lang="ts">
import { Toaster } from 'vue-sonner'

// A public readiness signal for browser consumers. SSR content can be visible
// before Nuxt finishes loading plugins and hydrating interactive components.
const appHydrated = ref(false)
onNuxtReady(() => { appHydrated.value = true })

useHead({
  htmlAttrs: { 'data-app-hydrated': computed(() => String(appHydrated.value)) },
  titleTemplate: title => title ? `${title} · Nuxt Starter` : 'Nuxt Starter',
  meta: [{ name: 'description', content: 'A production-sensible Nuxt full-stack starter.' }],
})
</script>

<template>
  <NuxtLoadingIndicator />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <Toaster rich-colors />
</template>
