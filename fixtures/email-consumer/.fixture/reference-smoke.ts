// Run from the repository after its production build, with migrated DATABASE_URL.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mailpitEnv, startMailpit } from './mailpit'

const fixture = await startMailpit()
const base = 'http://127.0.0.1:3195'
const recipient = `root-${randomUUID()}@example.test`
let output = ''
const server = spawn('node', ['.output/server/index.mjs'], {
  env: { ...process.env, ...mailpitEnv(fixture.port), NODE_ENV: 'production', NITRO_PORT: '3195', NITRO_HOST: '127.0.0.1',
    NUXT_MAGIC_LINK_ENABLED: 'true', NUXT_PUBLIC_MAGIC_LINK_ENABLED: 'true', NUXT_PUBLIC_APP_BASE_URL: base },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', chunk => { output += chunk.toString() })
server.stderr.on('data', chunk => { output += chunk.toString() })
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break } }
    catch { /* await production startup */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert(ready, 'Root production health succeeds')
  const request = await fetch(`${base}/api/auth/sign-in/magic-link`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: recipient, callbackURL: '/app/projects' }) })
  assert.equal(request.status, 200, 'Real root auth endpoint accepts SMTP request')
  const messages = await fixture.messages()
  assert.equal(messages.length, 1)
  const captured = await fixture.api(`message/${messages[0]!.ID}`)
  assert(captured.To[0].Address === recipient && captured.Text && captured.HTML, 'Delivered text and HTML to expected recipient')
  const link = captured.Text.match(/https?:\/\/[^\s]+/u)?.[0]
  assert(link, 'Magic link present internally')
  const url = new URL(link)
  assert(url.origin === base, 'Canonical origin')
  const redeemed = await fetch(url, { redirect: 'manual' })
  assert.equal(redeemed.status, 302)
  const cookie = redeemed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const session = await fetch(`${base}/api/auth/get-session`, { headers: { cookie } })
  const body = await session.json()
  assert(body?.user.email === recipient, 'Real root session endpoint confirms redemption')
  for (const value of [recipient, link, url.searchParams.get('token')!, captured.Text, captured.HTML]) assert(!output.includes(value), 'Production output has no mail secrets')
  console.info('[email] Real production Nitro auth endpoint: SMTP delivery, canonical link, redemption/session and private logs passed')
}
finally {
  server.kill('SIGTERM')
  if (server.exitCode === null) await new Promise<void>(resolve => server.once('exit', () => resolve()))
  await fixture.close()
  // Disposable smoke users are scoped to this test, with no schema changes.
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import('postgres')
    const sql = postgres(process.env.DATABASE_URL, { max: 1 })
    try {
      await sql`delete from "verification" where value like ${`%${recipient}%`}`
      await sql`delete from "user" where email = ${recipient}`
    }
    finally { await sql.end() }
  }
}
