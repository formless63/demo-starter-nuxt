<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
type Operation = { id: string, kind: string, status: string, error: { message: string } | null }
type Invoice = { bindingId: string, remoteId: string, number: string | null, status: string, amount: string | null, currency: string | null, balance: string | null, syncedAt: string, deleted: boolean }
const bindingId = ref(''), kind = ref('client'), busy = ref(false), message = ref(''), operationId = ref('')
const operation = ref<Operation | null>(null)
const { data, refresh } = await useFetch<{ items: Invoice[] }>('/api/integrations/invoice-ninja/invoices', { default: () => ({ items: [] }) })
const ready = ref(false)
onMounted(() => { ready.value = true })
let controller: AbortController | undefined
async function action(work: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return
  busy.value = true; message.value = ''; controller = new AbortController()
  try { await work(controller.signal) }
  catch { message.value = 'The operation could not complete. Check configuration, binding access, and operation status.' }
  finally { busy.value = false; controller = undefined }
}
function reconcile() {
  return action(async signal => {
    const response = await $fetch<{ operationId: string }>(`/api/integrations/invoice-ninja/reconcile-${kind.value}` as '/api/integrations/invoice-ninja/reconcile-client', { method: 'POST', signal, body: kind.value === 'client' ? { clientBindingId: bindingId.value } : { invoiceBindingId: bindingId.value } })
    operationId.value = response.operationId; message.value = 'Reconciliation queued. Refresh operation status to see the result.'
  })
}
function status() { return action(async signal => { operation.value = await $fetch<Operation>(`/api/integrations/invoice-ninja/operations/${operationId.value}` as '/api/integrations/invoice-ninja/operations/:operationId', { signal }); await refresh() }) }
function cancelQueued() { return action(async signal => { operation.value = await $fetch<Operation>(`/api/integrations/invoice-ninja/operations/${operationId.value}/cancel` as '/api/integrations/invoice-ninja/operations/:operationId/cancel', { method: 'POST', signal }); message.value = 'Cancellation applies to queued operations. A dispatched draft may require reconciliation.' }) }
onBeforeUnmount(() => controller?.abort())
</script>
<template>
  <main class="mx-auto max-w-4xl space-y-6 p-6">
    <NuxtLink to="/app/projects" class="underline">Back to projects</NuxtLink>
    <h1 class="text-2xl font-semibold">Invoice Ninja</h1>
    <p>Read local invoices and request an explicit refresh of an existing server-owned binding. Invoice Ninja owns financial state.</p>
    <p class="text-sm text-muted-foreground">Draft creation requires a deployment-verified unsent company policy. The reference application has no configured draft policy.</p>
    <form class="flex flex-wrap gap-3 rounded-lg border p-4" @submit.prevent="reconcile">
      <label>Resource <select v-model="kind" class="rounded border p-2"><option value="client">Client</option><option value="invoice">Invoice</option></select></label>
      <label>Binding UUID <input v-model="bindingId" :disabled="!ready" required class="rounded border p-2" placeholder="Server-owned binding UUID"></label>
      <Button type="submit" :disabled="busy || !ready">Request reconciliation</Button>
      <Button v-if="busy" type="button" variant="outline" @click="controller?.abort()">Stop waiting</Button>
    </form>
    <p role="status">{{ message }}</p>
    <section class="space-y-3 rounded-lg border p-4" aria-label="Operation status">
      <label>Operation UUID <input v-model="operationId" :disabled="!ready" class="rounded border p-2"></label>
      <Button :disabled="busy || !ready || !operationId" @click="status">Refresh operation</Button>
      <Button variant="outline" :disabled="busy || !ready || !operationId" @click="cancelQueued">Cancel queued operation</Button>
      <p v-if="operation">{{ operation.kind }}: {{ operation.status }} {{ operation.error?.message }}</p>
    </section>
    <section class="space-y-3" aria-label="Local invoice projections">
      <h2 class="text-lg font-semibold">Local invoices</h2>
      <Button variant="outline" :disabled="busy || !ready" @click="refresh()">Refresh local list</Button>
      <p v-if="!data?.items.length">No synchronized invoices in your scope.</p>
      <ul v-else class="space-y-3"><li v-for="invoice in data.items" :key="invoice.bindingId" class="rounded-lg border p-4">
        <strong>{{ invoice.number || 'Unnumbered invoice' }}</strong> — {{ invoice.status }}<br>
        {{ invoice.amount ?? 'Unknown amount' }} {{ invoice.currency ?? '' }}; balance {{ invoice.balance ?? 'unknown' }}<br>
        Synced {{ invoice.syncedAt }} <span v-if="invoice.deleted">(retained tombstone)</span>
      </li></ul>
    </section>
  </main>
</template>
