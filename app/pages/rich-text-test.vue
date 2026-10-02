<script setup lang="ts">
import { ref, toRaw } from 'vue'
import { onNuxtReady, useAsyncData } from '#app'
import { parseRichTextDocument, type RichTextDocument } from '@repo/nuxt-rich-text/runtime'
const value = ref<RichTextDocument>({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello rich text' }] }] })
// Canonicalize loaded input BEFORE Nuxt serializes it; SSR and hydration use this same value.
const { data: unicode } = await useAsyncData('rich-text-unicode', async () => parseRichTextDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'line1\r\nline2\rline3 😀 � café' }] }] }))
const documentKey = ref('initial')
let record = 0
function switchRecord() { documentKey.value = `record-${++record}`; value.value = structuredClone(toRaw(value.value)) }
const reject = ref(false), visible = ref(true), readOnly = ref(false)
function change(next: RichTextDocument) { if (!reject.value) value.value = next }
function replace() { documentKey.value = `record-${++record}`; value.value = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Replacement document' }] }] } }
onNuxtReady(() => { document.documentElement.dataset.appHydrated = 'true' })
</script>
<template><main><h1>Rich text example</h1><button @click="reject = !reject">{{ reject ? 'Accept changes' : 'Reject changes' }}</button><button @click="visible = !visible">Toggle editor</button><button @click="readOnly = !readOnly">Toggle read only</button><button @click="replace">Replace document</button><button @click="switchRecord">Switch equal record</button><RichTextEditor v-if="visible" :document-key="documentKey" :value="value" label="Document" :on-change="change" :read-only="readOnly" /><RichTextContent :value="value" label="Preview" /><RichTextContent v-if="unicode" :value="unicode" label="Unicode fidelity" /><output aria-label="Document JSON">{{ JSON.stringify(value) }}</output></main></template>
