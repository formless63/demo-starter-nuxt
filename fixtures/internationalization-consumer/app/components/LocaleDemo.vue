<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useLocaleLoader, type I18nPayload } from '@repo/nuxt-internationalization/runtime'
const props = defineProps<{ initial: I18nPayload }>()
const delay = ref(false)
const fail = ref(false)
const invalid = ref(false)
// This demo intentionally ignores AbortSignal to exercise the generation fence.
const { runtime, status, change, cancel } = useLocaleLoader(props.initial, async (locale) => {
  const slow = delay.value, failure = fail.value, malformed = invalid.value
  const next = await $fetch<I18nPayload>('/api/i18n-reference', { query: { locale } })
  if (slow) await new Promise(resolve => setTimeout(resolve, 650))
  if (failure) throw new Error('Demo failure')
  if (malformed) return { ...next, locales: { en: { direction: 'ltr', messages: { bad: '{broken' } } } }
  return next
})
const router = useRouter()
const route = useRoute()
const accepted = shallowRef(props.initial)
const ownPath = route.path
const removeAfter = router.afterEach((to, _from, failure) => {
  const locale = typeof to.query.locale === 'string' && Object.hasOwn(props.initial.locales, to.query.locale)
    ? to.query.locale : props.initial.defaultLocale
  if (!failure && to.path === ownPath && runtime.value.payload.locale === locale) accepted.value = runtime.value.payload
})
onUnmounted(removeAfter)
const hydrated = ref(false)
onMounted(() => { hydrated.value = true })
// Native router guards own commits and Back/Forward rollback. No competing popstate listener.
onBeforeRouteUpdate(async (to) => {
  const locale = typeof to.query.locale === 'string' && Object.hasOwn(props.initial.locales, to.query.locale)
    ? to.query.locale : props.initial.defaultLocale
  return await change(locale)
})
onBeforeRouteLeave(() => { cancel(); return true })
function select(locale: string) {
  cancel()
  void router.push({ query: { ...route.query, locale } })
}
</script>
<template>
  <div>
    <nav aria-label="Locale"><button v-for="locale in ['en', 'de', 'ar']" :key="locale" type="button" :disabled="!hydrated" @click="select(locale)">{{ locale }}</button></nav>
    <label><input v-model="delay" type="checkbox"> Slow loader</label>
    <label><input v-model="fail" type="checkbox"> Fail loader</label>
    <label><input v-model="invalid" type="checkbox"> Invalid catalog</label>
    <button type="button" :disabled="!hydrated || status !== 'loading'" @click="cancel">Cancel locale change</button>
    <p role="status">{{ status }}</p>
    <InternationalizationProvider v-slot="{ i18n }" :payload="accepted">
      <h1>{{ i18n.text('title', { name: 'Ada' }) }}</h1>
      <p data-fallback>{{ i18n.text('fallback') }}</p>
      <p data-missing>{{ i18n.text('missing.key') }}</p>
      <p v-for="count in [0, 1, 2, 3, 11, 100]" :key="count" :data-count="count">{{ i18n.text('items', {}, count) }}</p>
      <p data-malicious>{{ i18n.text('malicious') }}</p>
      <p data-unicode>{{ i18n.text('unicode') }}</p>
      <p data-price>{{ i18n.payload.formatted.price }}</p>
      <p data-date>{{ i18n.payload.formatted.date }}</p>
    </InternationalizationProvider>
  </div>
</template>
