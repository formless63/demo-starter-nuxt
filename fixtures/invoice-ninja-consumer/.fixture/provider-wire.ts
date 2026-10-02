import assert from 'node:assert/strict'
import { InvoiceNinjaError, providerRequest } from '@repo/nuxt-invoice-ninja/server'

assert.equal(Number(process.versions.node.split('.')[0]), 24)
const clientId = process.env.GS_CLIENT_ID, apiToken = process.env.GS_FIXTURE_TOKEN
assert(clientId && apiToken)
// This process shares the isolated provider container's network namespace.
// The literal loopback rule stays intact; no host port or external API is used.
const connection = { baseUrl: 'http://127.0.0.1:8000', apiToken }
let stage = 'client_get'
try {
  await providerRequest(connection, 'client', clientId)
  stage = 'draft_post'
  const raw = await providerRequest(connection, 'invoice', null, {
    client_id: clientId, currency_id: '1', date: '2026-10-02', number: 'GS-FIXTURE-1',
    line_items: [{ notes: 'Disposable compatibility check', quantity: '1.25', cost: '20.0000' }],
  }) as { data: { id: string, client_id: string, status_id: string, amount: string, balance: string, auto_bill_enabled: boolean } }
  stage = 'client_identity'; assert.equal(raw.data.client_id, clientId)
  stage = 'draft_status'; assert.equal(raw.data.status_id, '1')
  stage = 'auto_bill_disabled'; assert.equal(raw.data.auto_bill_enabled, false)
  stage = 'exact_amount'; assert.equal(raw.data.amount, '25')
  // Native drafts have zero outstanding balance until explicitly marked sent.
  // v5.13.43 InvoiceFactory::create / Invoice\\MarkSent own that transition.
  stage = 'exact_balance'; assert.equal(raw.data.balance, '0')
  stage = 'invoice_get'; await providerRequest(connection, 'invoice', raw.data.id)
  console.info('Native provider wire assertions passed on Node24')
}
catch (error) {
  // Only locally authored stage names and closed package error codes leave the
  // isolated fixture. Never print assertion values, provider bodies or tokens.
  const code = error instanceof InvoiceNinjaError ? error.code : 'assertion_or_runtime'
  console.error(`GS_NATIVE_WIRE_FAILURE stage=${stage} code=${code}`)
  process.exitCode = 1
}
