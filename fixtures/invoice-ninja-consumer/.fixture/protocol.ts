import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { draftInput, parse, decodeCursor, providerRequest, parseExactJSON, validateConnection, verifyWebhookSecret, InvoiceNinjaError } from '@repo/nuxt-invoice-ninja/server'
const secret = 's'.repeat(32), connection = { baseUrl: '', apiToken: 'fixture-token', webhookSecret: secret, previousWebhookSecret: 'p'.repeat(32) }
const input = { clientBindingId: '00000000-0000-4000-8000-000000000001', idempotencyKey: 'draft:1', invoiceDate: '2026-10-02', numbering: { mode: 'provider' }, lines: [{ description: 'fixture', quantity: '1.0000', unitCost: '99999999999999.1234' }] }
assert.equal(parse(draftInput, input).lines[0]!.quantity, '1')
for (const bad of [{ ...input, status: 'paid' }, { ...input, invoiceDate: '2026-02-30' }, { ...input, dueDate: '2026-10-01' }, { ...input, lines: [{ description: 'x', quantity: '0.000', unitCost: '1' }] }]) assert.throws(() => parse(draftInput, bad), InvoiceNinjaError)
const exact = parseExactJSON(Buffer.from('{"amount":999999999999999999999999.12345678,"balance":-1.2300,"text":"123"}')) as { amount: string, balance: string }
assert.equal(exact.amount, '999999999999999999999999.12345678'); assert.equal(exact.balance, '-1.2300')
for (const baseUrl of ['http://localhost:1234', 'http://2130706433', 'http://127.1', 'http://0x7f000001', 'https://user:pass@example.com', 'https://example.com/#bad']) assert.throws(() => validateConnection({ ...connection, baseUrl }), InvoiceNinjaError)
verifyWebhookSecret(secret, connection); verifyWebhookSecret('p'.repeat(32), connection)
assert.throws(() => verifyWebhookSecret('wrong', connection), InvoiceNinjaError)
assert.throws(() => verifyWebhookSecret('s'.repeat(8193), connection), InvoiceNinjaError)
for (const cursor of ['abc=', Buffer.from('[1,"2026-10-02T00:00:00Z","00000000-0000-4000-8000-000000000001"]').toString('base64url')]) assert.throws(() => decodeCursor(cursor), InvoiceNinjaError)
let calls = 0, closed = 0
const server = createServer((request, response) => {
  calls++; request.on('close', () => closed++)
  assert.equal(request.headers['x-api-token'], 'fixture-token'); assert.equal(request.headers['x-requested-with'], 'XMLHttpRequest')
  assert.equal(request.headers['x-api-secret'], undefined); assert.equal(request.headers.authorization, undefined)
  if (request.url === '/api/v1/invoices/large') { response.writeHead(200); for (let i = 0; i < 40; i++) response.write(Buffer.alloc(65536, 32)); response.end(); return }
  if (request.url === '/api/v1/invoices/slow') { response.writeHead(200); response.write('{"data":'); return }
  if (request.url === '/api/v1/invoices/headers') return
  if (request.url === '/api/v1/invoices/missing') { response.writeHead(404); response.end('{}'); return }
  if (request.url === '/api/v1/invoices') { assert.equal(request.method, 'POST'); request.resume(); request.on('end', () => { response.destroy() }); return }
  assert.equal(request.url, '/api/v1/clients/bound%2Fid'); assert.equal(request.method, 'GET')
  response.end('{"data":{"id":"bound/id","contact_email":"private@example.test"}}')
})
await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
connection.baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
try {
  await providerRequest(connection, 'client', 'bound/id')
  assert.equal(await providerRequest(connection, 'invoice', 'missing'), null)
  await assert.rejects(providerRequest(connection, 'invoice', 'large'), (e: unknown) => e instanceof InvoiceNinjaError && e.code === 'limit_exceeded')
  for (const id of ['slow', 'headers']) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 80)
    await assert.rejects(providerRequest(connection, 'invoice', id, undefined, controller.signal), (e: unknown) => e instanceof InvoiceNinjaError && e.code === 'cancelled')
    clearTimeout(timer)
  }
  const before = calls
  await assert.rejects(providerRequest(connection, 'invoice', null, { client_id: 'bound-client', line_items: [{ quantity: '1', cost: '1.2345' }] }))
  assert.equal(calls, before + 1, 'No hidden retries after disconnected create')
  assert.ok(closed > 0)
  console.info(`Invoice Ninja mocked protocol passed (${process.release.name} ${process.version}); actual pinned compatibility unverified`)
}
finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
