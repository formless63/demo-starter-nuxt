<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { createInternationalization, type I18nPayload } from '../i18n'
import { provideInternationalization } from '../locale'
const props = defineProps<{ payload: I18nPayload }>()
const runtime = shallowRef(createInternationalization(props.payload))
provideInternationalization(runtime)
watch(() => props.payload, (payload) => {
  const next = createInternationalization(payload)
  const previous = runtime.value
  runtime.value = next
  previous.instance.dispose()
})
onScopeDispose(() => runtime.value.instance.dispose())
const direction = computed(() => runtime.value.payload.locales[runtime.value.payload.locale]!.direction)
</script>
<template>
  <section :lang="runtime.payload.locale" :dir="direction" data-i18n-scope>
    <slot :i18n="runtime" />
  </section>
</template>
