<script setup lang="ts">
import { MarkdownContent } from '@repo/nuxt-markdown-code/components'
defineOptions({ name: 'MarkdownReferencePage' })
const { data: document } = await useFetch('/api/markdown-reference')
</script>

<template>
  <main><MarkdownContent v-if="document" :document="document" /></main>
</template>
