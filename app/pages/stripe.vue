<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const customerBindingId = ref(''), offerId = ref('starter.one-time'), quantity = ref(1), key = ref('')
const operationId = ref(''), checkoutBindingId = ref(''), busy = ref(false), message = ref('')
const ready = ref(false)
onMounted(() => { ready.value = true })
let cancellation: AbortController | undefined
const checkout = ref<{ checkoutUrl?: string | null } | null>(null)
async function loadCheckout() { checkout.value = await $fetch<{ checkoutUrl?: string | null }>('/api/integrations/stripe/checkout', { query: { bindingId: checkoutBindingId.value } }) }
const { data: payments, refresh } = await useFetch('/api/integrations/stripe/payments')
async function action(kind: 'checkout' | 'operation' | 'reconcile' | 'cancel') {
  cancellation?.abort(); cancellation = new AbortController(); busy.value = true
  try {
    if (!key.value) key.value = crypto.randomUUID()
    const result = await $fetch<Record<string, unknown>>(`/api/integrations/stripe/${kind}`, {
      method: kind === 'operation' ? 'GET' : 'POST', signal: cancellation.signal,
      query: kind === 'operation' ? { operationId: operationId.value } : undefined,
      body: kind === 'checkout' ? { customerBindingId: customerBindingId.value, idempotencyKey: key.value, items: [{ offerId: offerId.value, quantity: quantity.value }] } : kind === 'reconcile' ? { kind: 'checkout', bindingId: checkoutBindingId.value } : kind === 'cancel' ? { operationId: operationId.value } : undefined,
    })
    if (typeof result.operationId === 'string') operationId.value = result.operationId
    message.value = JSON.stringify(result); await refresh()
  }
  catch { message.value = 'Request stopped or unavailable. A stopped request does not undo provider activity.' }
  finally { busy.value = false }
}
onBeforeUnmount(() => cancellation?.abort())
</script>
<template>
  <main class="mx-auto max-w-3xl space-y-5 p-6">
    <h1 class="text-2xl font-semibold">One-time Checkout</h1>
    <p>Existing customer bindings and registered offers require server operator configuration. Checkout completion and payment success are separate; redirects do not establish payment.</p>
    <form class="grid gap-3" @submit.prevent="action('checkout')">
      <label>Customer binding <input v-model="customerBindingId" :disabled="!ready" class="rounded border p-2" required></label>
      <label>Registered offer <input v-model="offerId" :disabled="!ready" class="rounded border p-2" required></label>
      <label>Quantity <input v-model.number="quantity" :disabled="!ready" type="number" min="1" max="100" class="rounded border p-2"></label>
      <label>Intent key <input v-model="key" :disabled="!ready" class="rounded border p-2" placeholder="Generated for first request"></label>
      <button class="rounded border p-2" :disabled="busy">Queue Checkout</button>
    </form>
    <p>Repeating the same intent key reads the original operation. Changed intent requires a new deliberate key.</p>
    <label>Operation <input v-model="operationId" :disabled="!ready" class="rounded border p-2"></label>
    <button class="rounded border p-2" :disabled="busy || !operationId" @click="action('operation')">Refresh operation</button>
    <button class="rounded border p-2" :disabled="busy || !operationId" @click="action('cancel')">Cancel queued operation</button>
    <button class="rounded border p-2" :disabled="!busy" @click="cancellation?.abort()">Stop request</button>
    <label>Checkout binding <input v-model="checkoutBindingId" :disabled="!ready" class="rounded border p-2"></label>
    <button class="rounded border p-2" :disabled="busy || !checkoutBindingId" @click="action('reconcile')">Reconcile Checkout</button>
    <button class="rounded border p-2" :disabled="busy || !checkoutBindingId" @click="loadCheckout">Read Checkout</button>
    <a v-if="checkout?.checkoutUrl" :href="checkout.checkoutUrl" rel="noopener noreferrer" class="underline">Open hosted Checkout</a>
    <output class="block" aria-live="polite">{{ message }}</output>
    <h2 class="text-xl">Local payment status</h2><pre class="overflow-auto">{{ payments }}</pre>
  </main>
</template>
