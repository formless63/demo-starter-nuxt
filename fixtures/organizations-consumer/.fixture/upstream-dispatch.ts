import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { runWithTransaction } from '@better-auth/core/context'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './upstream-schema.ts'

const databaseUrl = process.env.ORGANIZATIONS_PROBE_DATABASE_URL
assert(databaseUrl, 'Disposable database URL is required')
const dispatch = process.env.ORGANIZATIONS_PROBE_DISPATCH
assert(dispatch === 'api' || dispatch === 'http')
const client = new pg.Pool({ connectionString: databaseUrl, max: 3 })
client.on('error', () => {})
const db = drizzle(client, { schema })
const secret = 'disposable-organization-probe-secret-only-123456789'
const origin = 'http://localhost:3997'
const auth = betterAuth({
  baseURL: origin, secret,
  database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }),
  emailAndPassword: { enabled: false },
  trustedOrigins: [origin],
  logger: { disabled: true },
  plugins: [organization({
    creatorRole: 'owner', disableOrganizationDeletion: true,
    teams: { enabled: false }, dynamicAccessControl: { enabled: false },
    requireEmailVerificationOnInvitation: true,
  })],
})
const token = 'probe-session-token'
const signature = createHmac('sha256', secret).update(token).digest('base64')
const headers = new Headers({
  cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  origin,
  'content-type': 'application/json',
})
async function invoke() {
  if (dispatch === 'api') {
    const result = await auth.api.acceptInvitation({ headers, body: { invitationId: 'probe-invitation' } })
    assert.equal(result.invitation.status, 'accepted')
    assert.equal(result.member.userId, 'probe-recipient')
  }
  else {
    const response = await auth.handler(new Request(`${origin}/api/auth/organization/accept-invitation`, {
      method: 'POST', headers, body: JSON.stringify({ invitationId: 'probe-invitation' }),
    }))
    assert.equal(response.status, 200)
    const result = await response.json() as { invitation: { status: string }, member: { userId: string } }
    assert.equal(result.invitation.status, 'accepted')
    assert.equal(result.member.userId, 'probe-recipient')
  }
}
try {
  if (process.env.ORGANIZATIONS_PROBE_ENCLOSING_TRANSACTION === 'true') {
    await runWithTransaction((await auth.$context).adapter, invoke)
  }
  else await invoke()
  console.info('dispatch completed')
}
finally {
  await client.end()
}
