<script setup lang="ts">
import { Toaster } from 'vue-sonner'

useHead({
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
