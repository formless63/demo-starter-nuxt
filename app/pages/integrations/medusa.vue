<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
type Product = { bindingId: string, remoteId: string, title: string, status: string, syncedAt: string, deleted: boolean }
type Order = { bindingId: string, remoteId: string, status: string, paymentStatus: string, fulfillmentStatus: string, currency: string | null, total: string | null, syncedAt: string, deleted: boolean }
type Operation = { id?: string, operationId?: string, status: string, error?: { message: string } | null }
const { data: products, refresh: refreshProducts } = await useFetch<{ items: Product[], nextCursor: string | null }>('/api/integrations/medusa/products')
const { data: orders, refresh: refreshOrders } = await useFetch<{ items: Order[], nextCursor: string | null }>('/api/integrations/medusa/orders')
const ready = ref(false)
onMounted(() => { ready.value = true })
const pending = ref(false), operation = ref<Operation | null>(null), message = ref(''), active = ref<AbortController | null>(null)
async function act(path: 'sync' | 'reconcile', input: { kind: 'product' | 'order', bindingId?: string }) {
  if (!ready.value || pending.value) return
  pending.value = true; message.value = ''; const controller = new AbortController(); active.value = controller
  try {
    operation.value = await $fetch<Operation>(`/api/integrations/medusa/${path}`, { method: 'POST', body: input, signal: controller.signal })
    message.value = 'Reconciliation accepted. Check status after the worker runs.'
  }
  catch { message.value = controller.signal.aborted ? 'Request stopped. Check status: accepted work may continue.' : 'Integration unavailable or request rejected.' }
  finally { pending.value = false; active.value = null }
}
async function check() {
  const operationId = operation.value?.operationId ?? operation.value?.id
  if (!operationId) return
  try { operation.value = await $fetch<Operation>('/api/integrations/medusa/operation', { query: { operationId } }); await Promise.all([refreshProducts(), refreshOrders()]) }
  catch { message.value = 'Unable to read operation.' }
}
async function cancelQueued() {
  const operationId = operation.value?.operationId ?? operation.value?.id
  if (!operationId) return
  try { operation.value = await $fetch<Operation>('/api/integrations/medusa/cancel', { method: 'POST', body: { operationId } }) }
  catch { message.value = 'Work already dispatched or unavailable. Check status.' }
}
onBeforeUnmount(() => active.value?.abort())
</script>
<template>
  <main class="mx-auto max-w-5xl space-y-6 p-6">
    <h1 class="text-2xl font-semibold">Medusa reconciliation</h1>
    <p>Read local product and order projections. An operator must create authorized bindings. Sync refreshes one page of up to 25 provider resources; it does not import the store or create bindings.</p>
    <p>Orders and products remain authoritative in Medusa. This view contains only the approved local fields.</p>
    <div class="flex flex-wrap gap-3">
      <button :disabled="!ready || pending" class="rounded border px-3 py-2" @click="act('sync', { kind: 'product' })">Sync product page</button>
      <button :disabled="!ready || pending" class="rounded border px-3 py-2" @click="act('sync', { kind: 'order' })">Sync order page</button>
      <button v-if="pending" class="rounded border px-3 py-2" @click="active?.abort()">Stop request</button>
      <button :disabled="!operation" class="rounded border px-3 py-2" @click="check">Check status</button>
      <button :disabled="operation?.status !== 'queued'" class="rounded border px-3 py-2" @click="cancelQueued">Cancel queued work</button>
    </div>
    <p role="status">{{ message }} {{ operation?.status }}</p>
    <h2 class="text-xl font-medium">Products</h2>
    <p v-if="!products?.items?.length">No synchronized products.</p>
    <ul class="space-y-3">
      <li v-for="product in products?.items" :key="product.bindingId" class="rounded border p-3">
        <span>{{ product.title }} · {{ product.status }} · {{ product.syncedAt }}</span>
        <button :disabled="!ready || pending" class="ml-3 underline" @click="act('reconcile', { kind: 'product', bindingId: product.bindingId })">Reconcile product</button>
      </li>
    </ul>
    <h2 class="text-xl font-medium">Orders</h2>
    <p v-if="!orders?.items?.length">No synchronized orders.</p>
    <ul class="space-y-3">
      <li v-for="order in orders?.items" :key="order.bindingId" class="rounded border p-3">
        <span>{{ order.status }} · {{ order.paymentStatus }} · {{ order.fulfillmentStatus }} · {{ order.currency }} {{ order.total }}</span>
        <button :disabled="!ready || pending" class="ml-3 underline" @click="act('reconcile', { kind: 'order', bindingId: order.bindingId })">Reconcile order</button>
      </li>
    </ul>
  </main>
</template>
