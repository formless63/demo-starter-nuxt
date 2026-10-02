<script setup lang="ts">
import { MarkdownContent } from '@repo/nuxt-markdown-code/components'
defineOptions({ name: 'MalformedDocumentFixture' })
const { data: document } = await useFetch('/api/malformed')
</script>

<template><MarkdownContent v-if="document" :document="document" /></template>
