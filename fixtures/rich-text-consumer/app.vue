<script setup lang="ts">
import { ref } from 'vue'
import { onNuxtReady } from '#app'
import type { RichTextDocument } from '@repo/nuxt-rich-text/runtime'
const value = ref<RichTextDocument>({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello rich text' }] }] })
const reject = ref(false), visible = ref(true), readOnly = ref(false)
function change(next: RichTextDocument) { if (!reject.value) value.value = next }
function replace() { value.value = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Replacement document' }] }] } }
onNuxtReady(() => { document.documentElement.dataset.appHydrated = 'true' })
</script>
<template><main><h1>Rich text example</h1><button @click="reject = !reject">{{ reject ? 'Accept changes' : 'Reject changes' }}</button><button @click="visible = !visible">Toggle editor</button><button @click="readOnly = !readOnly">Toggle read only</button><button @click="replace">Replace document</button><RichTextEditor v-if="visible" :value="value" label="Document" :on-change="change" :read-only="readOnly" /><RichTextContent :value="value" label="Preview" /><output aria-label="Document JSON">{{ JSON.stringify(value) }}</output></main></template>
