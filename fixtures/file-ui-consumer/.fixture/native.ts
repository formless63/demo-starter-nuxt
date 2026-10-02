import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { expect, type Browser } from '@playwright/test'
import type { FileView } from '@repo/nuxt-file-ui/runtime'
import type { startProtocol } from './protocol'

/** Actual production Nitro routes with an explicit synthetic session resolver. */
export async function runNative(base: string, alice: string, bob: string, protocol: Awaited<ReturnType<typeof startProtocol>>, browser: Browser) {
  const headers = { cookie: `file-fixture-session=${alice}`, origin: base, 'x-file-ui': '1' }
  const foreign = { ...headers, cookie: `file-fixture-session=${bob}` }
  const payload = Buffer.from('<html><script>not executed</script>\u0000fixture</html>')
  const putHeaders = { ...headers, 'content-type': 'text/html', 'x-file-name': encodeURIComponent('fixture ü.html'), 'idempotency-key': randomUUID() }
  const before = protocol.puts()
  assert.equal((await fetch(`${base}/api/files/list`)).status, 401)
  assert.equal((await fetch(`${base}/api/files/list`, { headers: { cookie: 'file-fixture-session=forged' } })).status, 401)
  assert.equal((await fetch(`${base}/api/files/upload`, { method: 'POST', headers: { ...putHeaders, origin: 'https://foreign.invalid' }, body: payload })).status, 403)
  assert.equal((await fetch(`${base}/api/files/upload`, { method: 'POST', headers: { ...putHeaders, 'x-file-ui': '' }, body: payload })).status, 403)
  assert.equal((await fetch(`${base}/api/files/upload?owner=synthetic-bob`, { method: 'POST', headers: putHeaders, body: payload })).status, 400)
  assert.equal((await fetch(`${base}/api/files/upload`, { method: 'POST', headers: putHeaders, body: Buffer.alloc(1025) })).status, 413)
  // Native chunked request proves the running-byte bound independently of Content-Length.
  const chunkedStatus = await new Promise<number>((resolve, reject) => {
    const outgoing = request(`${base}/api/files/upload`, { method: 'POST', headers: { ...putHeaders, 'transfer-encoding': 'chunked' } }, incoming => {
      incoming.resume()
      incoming.once('end', () => resolve(incoming.statusCode ?? 0))
    })
    outgoing.once('error', reject)
    outgoing.write(Buffer.alloc(512))
    outgoing.end(Buffer.alloc(513))
  })
  assert.equal(chunkedStatus, 413)
  assert.equal(protocol.puts(), before, 'Rejected requests never initiate an object PUT')

  const response = await fetch(`${base}/api/files/upload`, { method: 'POST', headers: putHeaders, body: payload })
  assert.equal(response.status, 200, await response.clone().text())
  const row = await response.json() as FileView
  assert.equal(row.state, 'ready')
  assert.deepEqual(Object.keys(row).sort(), ['id', 'name', 'size', 'state', 'type'])
  const replay = await fetch(`${base}/api/files/upload`, { method: 'POST', headers: putHeaders, body: payload })
  assert.equal(replay.status, 200)
  assert.deepEqual(await replay.json(), row)
  assert.equal(protocol.puts() - before, 1)
  assert.equal((await fetch(`${base}/api/files/upload`, { method: 'POST', headers: putHeaders, body: 'conflicting bytes' })).status, 409)
  const download = await fetch(`${base}/api/files/download?id=${row.id}`, { headers })
  assert.equal(download.status, 200)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload)
  assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/)
  assert.equal(download.headers.get('content-type'), 'application/octet-stream')
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
  assert.match(download.headers.get('content-security-policy') ?? '', /sandbox/)
  assert.match(download.headers.get('cache-control') ?? '', /private, no-store/)
  assert.deepEqual(await (await fetch(`${base}/api/files/list`, { headers: foreign })).json(), [])
  assert.equal((await fetch(`${base}/api/files/download?id=${row.id}`, { headers: foreign })).status, 404)
  assert.equal((await fetch(`${base}/api/files/remove?id=${row.id}`, { method: 'POST', headers: foreign })).status, 404)
  const removed = await fetch(`${base}/api/files/remove?id=${row.id}`, { method: 'POST', headers })
  assert.equal(removed.status, 200)
  assert.equal((await removed.json() as FileView).state, 'removed')
  assert.equal((await fetch(`${base}/api/files/download?id=${row.id}`, { headers })).status, 404)
  assert.equal(protocol.objects.size, 0)

  const context = await browser.newContext()
  const errors: string[] = []
  try {
    await context.addCookies([{ name: 'file-fixture-session', value: alice, url: base, httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (/hydration/i.test(message.text())) errors.push(message.text()) })
    await page.goto(`${base}/files`)
    await page.locator('[data-fixture-hydrated="true"]').waitFor()
    await page.getByLabel('Choose a file', { exact: true }).setInputFiles({ name: 'native-browser.txt', mimeType: 'text/plain', buffer: Buffer.from('mounted native bytes') })
    await page.getByRole('button', { name: 'Upload file', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Uploaded native-browser.txt.')
    const downloaded = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download native-browser.txt', exact: true }).click()
    const attachment = await downloaded
    assert.equal(attachment.suggestedFilename(), 'native-browser.txt')
    const stream = await attachment.createReadStream()
    assert(stream)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    assert.equal(Buffer.concat(chunks).toString(), 'mounted native bytes')
    await page.getByRole('button', { name: 'Remove native-browser.txt', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Removed native-browser.txt.')
    assert.equal(protocol.objects.size, 0)
    assert.deepEqual(errors, [])
  }
  finally { await context.close() }

  const retainedResponse = await fetch(`${base}/api/files/upload`, {
    method: 'POST', headers: { ...putHeaders, 'idempotency-key': randomUUID() }, body: 'retained across process restart',
  })
  assert.equal(retainedResponse.status, 200)
  const retained = await retainedResponse.json() as FileView
  assert.equal(retained.state, 'ready')
  assert.equal(protocol.objects.size, 1)
  console.info('[file-ui] packed Nitro raw HTTP/native mounted browser: trusted sessions, CSRF, owner isolation, bounded bytes, replay/conflict, attachment download and removal passed')
  return retained
}
