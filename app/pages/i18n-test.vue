<script setup lang="ts">
import type { I18nPayload } from '@repo/nuxt-internationalization/runtime'
const route = useRoute()
// Only explicit application input selects locale; no browser detection/persistence.
const { data, error } = await useFetch<I18nPayload>('/api/i18n-reference', { query: { locale: route.query.locale }, watch: false })
</script>
<template>
  <main><I18nLocaleDemo v-if="data" :initial="data" /><p v-else role="alert">{{ error ? 'Locale unavailable' : 'Loading locale' }}</p></main>
</template>
