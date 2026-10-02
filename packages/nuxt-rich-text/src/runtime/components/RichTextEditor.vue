<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, shallowRef, ref, type Component } from 'vue'
import { parseRichTextDocument, type RichTextDocument } from '../document'
import RichTextContent from './RichTextContent.vue'
const props = defineProps<{ value: RichTextDocument; documentKey: string; label: string; readOnly?: boolean; onChange: (value: RichTextDocument) => void }>()
const client = shallowRef<Component | null>(null)
const failed = ref(false)
let active = true
const validated = computed(() => {
  if (typeof props.documentKey !== 'string' || !props.documentKey.length) return null
  try { return parseRichTextDocument(props.value) } catch { return null }
})
onMounted(() => { import('./RichTextClient.vue').then(module => { if (active) client.value = module.default }, () => { if (active) failed.value = true }) })
onBeforeUnmount(() => { active = false })
</script>
<template>
  <p v-if="!validated" role="alert">Invalid rich-text document.</p>
  <RichTextContent v-else-if="readOnly" :value="validated" :label="label" />
  <component :is="client" v-else-if="client" :key="documentKey" :value="validated" :label="label" :on-change="onChange" />
  <div v-else :aria-busy="!failed"><RichTextContent :value="validated" :label="label" /><output>{{ failed ? 'Editor could not load.' : 'Loading editor…' }}</output></div>
</template>
