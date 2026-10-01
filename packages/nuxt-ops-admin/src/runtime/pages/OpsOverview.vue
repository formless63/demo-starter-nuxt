<script setup lang="ts">
import { shallowRef, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRequestEvent, useRequestHeaders, useAsyncData, clearNuxtData, navigateTo } from '#imports'
import type { OpsSummary } from '../server/index'
const requestEvent = import.meta.server ? useRequestEvent() : undefined
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
// Request-scoped SSR fetch; summaries stay local to this page and never use a shared query cache.
const summary = shallowRef<OpsSummary>()
const pending = ref(false)
const mounted = ref(false)
const denied = ref(false)
const failed = ref(false)
let generation = 0
let controller: AbortController | undefined
async function refresh() {
  if (!mounted.value || pending.value) return
  const current = ++generation
  controller = new AbortController()
  pending.value = true
  failed.value = false
  summary.value = undefined
  try {
    const result = await $fetch<OpsSummary>('/api/ops/summary', { headers, signal: controller.signal })
    if (current === generation) { summary.value = result; denied.value = false }
  }
  catch (error) {
    if (current !== generation) return
    const status = (error as { statusCode?: number }).statusCode
    if (status === 401) await navigateTo({ path: '/', query: { redirect: '/admin/ops' } })
    else if (status === 403) { denied.value = true; if (requestEvent) requestEvent.node.res.statusCode = 403 }
    else failed.value = true
  }
  finally { if (current === generation) pending.value = false }
}
// Nuxt transfers the authorized initial result in this request's hydration payload.
// Clear its entry as soon as local page state takes ownership.
const initialKey = 'ops-admin-initial'
const initial = await useAsyncData(initialKey, async () => {
  try { return { summary: await $fetch<OpsSummary>('/api/ops/summary', { headers }), status: 200 } }
  catch (error) { return { summary: undefined, status: (error as { statusCode?: number }).statusCode ?? 503 } }
}, { deep: false })
summary.value = initial.data.value?.summary
if (initial.data.value?.status === 401) await navigateTo({ path: '/', query: { redirect: '/admin/ops' } })
else if (initial.data.value?.status === 403) { denied.value = true; if (requestEvent) requestEvent.node.res.statusCode = 403 }
else if (!summary.value) failed.value = true
onMounted(() => { clearNuxtData(initialKey); mounted.value = true })
onBeforeUnmount(() => { generation++; controller?.abort(); summary.value = undefined; clearNuxtData(initialKey) })
</script>

<template>
  <main class="mx-auto max-w-5xl space-y-6 p-5 md:p-8">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div><h1 class="text-2xl font-semibold">Operations overview</h1><p>Read-only diagnostics. This view is not a readiness check.</p></div>
      <button type="button" class="rounded-md border px-4 py-2 disabled:opacity-50" :disabled="!mounted || pending || denied" @click="refresh">{{ pending ? 'Checking…' : 'Refresh' }}</button>
    </header>
    <p v-if="denied" role="alert">Access denied. An operator session is required.</p>
    <p v-else-if="failed" role="alert">Operations unavailable. Try refreshing.</p>
    <p v-if="pending" role="status" aria-live="polite">Checking operational status…</p>
    <template v-if="summary">
      <p>Last checked: <time :datetime="summary.checkedAt">{{ summary.checkedAt }}</time></p>
      <p v-if="!summary.adapters.length">No operational adapters are registered.</p>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <section v-for="card in summary.adapters" :key="card.id" class="rounded-lg border bg-card p-5" :aria-labelledby="`ops-${card.id}`">
          <h2 :id="`ops-${card.id}`" class="font-semibold">{{ card.title }}</h2>
          <p>Status: {{ card.status }}</p>
          <p v-if="card.code">{{ card.code }}</p>
          <dl v-if="card.counts"><template v-for="(count, name) in card.counts" :key="name"><dt>{{ name }}</dt><dd>{{ count }}</dd></template></dl>
          <p>Checked: <time :datetime="card.checkedAt">{{ card.checkedAt }}</time></p>
          <p v-if="card.durationMs !== undefined">Duration: {{ card.durationMs }} ms</p>
        </section>
      </div>
    </template>
    <NuxtLink to="/app">Back to application</NuxtLink>
  </main>
</template>
