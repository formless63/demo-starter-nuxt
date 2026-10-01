import assert from 'node:assert/strict'
import { createEmail, EmailError, resolveEmailConfig } from '@repo/nuxt-email/server'
import { mailpitEnv, startMailpit } from './mailpit'

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SMTP_|EMAIL_)/u.test(key)))
async function boot(extra: Record<string, string> = {}, path = '/') {
  const server = Bun.spawn(['node', '.output/server/index.mjs'], { env: { ...env, ...extra, PORT: '3196', HOST: '127.0.0.1' }, stdout: 'pipe', stderr: 'pipe' })
  try {
    let ready = false
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:3196${path}`)).ok) { ready = true; break } }
      catch { /* wait for production server */ }
      await Bun.sleep(200)
    }
    assert(ready, 'Installed module production boot/auto-import succeeds')
  }
  finally { server.kill('SIGTERM'); await server.exited }
}
await boot()
const fixture = await startMailpit()
const config = resolveEmailConfig(mailpitEnv(fixture.port))
const email = createEmail(config)
const message = { to: [{ address: 'to@example.test' }], subject: `SMTP fixture ${crypto.randomUUID()}`, text: 'Unicode Héllo 世界' }
try {
  await email.verify()
  assert.equal((await fixture.messages()).length, 0, 'verify must not send')
  for (const content of [{ text: message.text }, { html: '<p>Héllo 世界</p>' }, { text: message.text, html: '<p>Héllo 世界</p>' }]) {
    const result = await email.send({ ...message, ...content, text: 'text' in content ? content.text : undefined,
      cc: [{ address: 'cc@example.test' }], bcc: [{ address: 'bcc@example.test' }] })
    assert.equal(result.outcome, 'accepted'); assert.equal(result.accepted, 3); assert(result.messageId)
    assert.equal(typeof result.accepted, 'number'); assert.equal(typeof result.rejected, 'number')
    assert.deepEqual(Object.keys(result).sort(), ['accepted', 'messageId', 'outcome', 'rejected'])
    const captured = await fixture.api(`message/${(await fixture.messages())[0]!.ID}`)
    assert.equal(captured.From.Address, config.from.address); assert.equal(captured.From.Name, config.from.name)
    assert.equal(captured.To[0].Address, 'to@example.test'); assert.equal(captured.Cc[0].Address, 'cc@example.test')
    assert.equal(captured.Bcc[0].Address, 'bcc@example.test'); assert.equal(captured.ReplyTo[0].Address, 'reply@example.test')
    if (content.text) assert(captured.Text.includes(content.text))
    if (content.html) assert(captured.HTML.includes('世界'))
    const headers = await fixture.api(`message/${captured.ID}/headers`)
    // Mailpit adds a synthetic Bcc to its stored copy; inspect the SMTP DATA instead.
    const wireHeaders = fixture.connections.at(-1)!.split('DATA\r\n')[1]!.split('\r\n\r\n')[0]!
    assert(!/^bcc:/imu.test(wireHeaders), 'Bcc hidden in transmitted MIME headers')
    assert(headers['Message-Id'] || headers['Message-ID'], 'generated Message-ID')
  }
  const partial = await email.send({ ...message, cc: [{ address: 'blocked@invalid.test' }] })
  assert.deepEqual({ outcome: partial.outcome, accepted: partial.accepted, rejected: partial.rejected }, { outcome: 'partial', accepted: 1, rejected: 1 })
  for (const bad of [{ ...message, raw: 'raw' }, { ...message, html: { href: 'http://127.0.0.1:9/private' } }, { ...message, text: { path: '/etc/passwd' } },
    { ...message, headers: { Bcc: 'hidden' } }, { ...message, subject: 'x'.repeat(201) }, { ...message, text: 'x'.repeat(1048577) },
    { ...message, text: 'x'.repeat(524288), html: 'x'.repeat(524289) },
    { ...message, to: Array.from({ length: 51 }, () => ({ address: 'to@example.test' })) }]) {
    await assert.rejects(() => email.send(bad as never), error => error instanceof EmailError && error.code === 'message')
  }
  assert.equal((await email.send({ ...message, subject: 'x'.repeat(200) })).outcome, 'accepted')
  for (const [code, classification, retryable] of [[451, 'temporary-rejection', true], [550, 'permanent-rejection', false]] as const) {
    await fixture.chaos(code)
    const count = (await fixture.messages()).length
    const attempts = fixture.connections.length
    await assert.rejects(() => email.send(message), error => error instanceof EmailError && error.code === classification && error.retryable === retryable)
    assert.equal((await fixture.messages()).length, count)
    assert.equal(fixture.connections.length - attempts, 1, 'exactly one SMTP attempt; no retry')
  }
  await fixture.chaos()
  const unauthorized = createEmail({ ...config, password: 'wrong' })
  try { await assert.rejects(() => unauthorized.verify(), error => error instanceof EmailError && error.code === 'authentication') }
  finally { unauthorized.close() }
  const unavailable = createEmail({ ...config, port: 1 })
  try { await assert.rejects(() => unavailable.verify(), error => error instanceof EmailError && error.code === 'connection') }
  finally { unavailable.close() }
  await boot(mailpitEnv(fixture.port), '/api/check')
  console.info('[email] backendless boot, real SMTP/MIME/Unicode/cc/bcc/partial, limits, Chaos451/550 and auth/connection passed')
}
catch (error) {
  // eslint-disable-next-line preserve-caught-error -- SMTP causes can disclose recipients/provider responses in Bun test output
  throw new Error(`[email fixture] ${error instanceof EmailError ? error.code : 'contract'} check failed`)
}
finally { email.close(); await fixture.close() }
