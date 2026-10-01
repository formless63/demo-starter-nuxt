import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createNotificationEmailAdapter } from '../../../server/notifications/email-adapter'
import { closeEmail } from '@repo/nuxt-email/server'
import type { NotificationRecord } from '@repo/nuxt-notifications/server'
const name = `notification-email-${crypto.randomUUID().slice(0, 8)}`
const previous = { SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT, SMTP_SECURITY: process.env.SMTP_SECURITY, EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS }
try {
  execFileSync('docker', ['run', '-d', '--name', name, '-p', '127.0.0.1::1025', '-p', '127.0.0.1::8025', 'axllent/mailpit:v1.31.3'], { stdio: 'pipe' })
  const smtp = execFileSync('docker', ['port', name, '1025/tcp'], { encoding: 'utf8' }).trim()
  const http = execFileSync('docker', ['port', name, '8025/tcp'], { encoding: 'utf8' }).trim()
  process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = smtp.split(':').at(-1); process.env.SMTP_SECURITY = 'opportunistic'; process.env.EMAIL_FROM_ADDRESS = 'starter@example.test'
  const api = `http://${http}`
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${api}/api/v1/messages`)).ok) { ready = true; break } } catch { /* wait */ } await Bun.sleep(100) }
  assert(ready)
  const record: NotificationRecord = { id: crypto.randomUUID(), recipientId: 'stable-owner', type: 'fixture.created', title: 'Notification SMTP test', body: 'Plain body ☃', metadata: {}, createdAt: new Date(), readAt: null }
  let lookups = 0
  const adapter = createNotificationEmailAdapter(async () => { lookups++; return 'current@example.test' })
  assert.deepEqual(await adapter(record, new AbortController().signal), { outcome: 'delivered' })
  const result = await (await fetch(`${api}/api/v1/messages`)).json() as { messages: Array<{ ID: string, Subject: string, To: Array<{ Address: string }> }> }
  assert.equal(result.messages.length, 1); assert.equal(result.messages[0]!.Subject, record.title); assert.equal(result.messages[0]!.To[0]!.Address, 'current@example.test')
  const content = await (await fetch(`${api}/api/v1/message/${result.messages[0]!.ID}`)).json() as { Text: string }
  assert.equal(content.Text.trim(), record.body); assert.equal(lookups, 1)
  console.info('[notifications Email] Root adapter/current recipient lookup/existing SMTP capability delivered once to disposable Mailpit')
}
finally {
  await closeEmail()
  execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' })
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) Reflect.deleteProperty(process.env, key); else process.env[key] = value }
}
