import assert from 'node:assert/strict'
import { providerRequest } from '@repo/nuxt-invoice-ninja/server'

assert.equal(Number(process.versions.node.split('.')[0]), 24)
const clientId = process.env.GS_CLIENT_ID, apiToken = process.env.GS_FIXTURE_TOKEN
assert(clientId && apiToken)
// This process shares the isolated provider container's network namespace.
// The literal loopback rule stays intact; no host port or external API is used.
const connection = { baseUrl: 'http://127.0.0.1:8000', apiToken }
await providerRequest(connection, 'client', clientId)
const raw = await providerRequest(connection, 'invoice', null, {
  client_id: clientId, currency_id: '1', date: '2026-10-02', number: 'GS-FIXTURE-1',
  line_items: [{ notes: 'Disposable compatibility check', quantity: '1.25', cost: '20.0000' }],
}) as { data: { id: string, client_id: string, status_id: string, amount: string, balance: string, auto_bill_enabled: boolean } }
assert.equal(raw.data.client_id, clientId)
assert.equal(raw.data.status_id, '1')
assert.equal(raw.data.auto_bill_enabled, false)
assert.equal(raw.data.amount, '25')
assert.equal(raw.data.balance, '25')
await providerRequest(connection, 'invoice', raw.data.id)
console.info('Native provider wire assertions passed on Node24')
