import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle as postgresDrizzle } from 'drizzle-orm/postgres-js'
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres'
import postgres from 'postgres'
import pg from 'pg'
import { organizationsAuth, organizationAuthErrorBoundary, resolveTenantContext, listOrganizations, listMembers, resolveOrganizationsConfig, diagnoseInvitation, addOrganizationMember, resolveTenantContextTx } from '@repo/nuxt-organizations/server'
import * as schema from './upstream-schema.ts'

const url = process.env.ORGANIZATIONS_PROBE_DATABASE_URL
assert(url)
const driver = process.env.ORGANIZATIONS_PROBE_DRIVER
const admin = postgres(url, { max: 2 })
const client = driver === 'pg' ? new pg.Pool({ connectionString: url, max: 5, options: '-c statement_timeout=5000 -c lock_timeout=2000' }) : postgres(url, { max: 5, connection: { statement_timeout: 5000, lock_timeout: 2000 } })
const db = driver === 'pg' ? pgDrizzle(client as pg.Pool, { schema }) : postgresDrizzle(client as ReturnType<typeof postgres>, { schema })
const secret = 'disposable-organization-contract-secret-only-123456789'
const origin = 'http://localhost:3997'
const auth = betterAuth({ baseURL: origin, secret, database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }), emailAndPassword: { enabled: false }, trustedOrigins: [origin], logger: { disabled: true }, onAPIError: organizationAuthErrorBoundary, plugins: [...organizationsAuth()] })
const prefix = randomUUID()
const actorIds: Record<string, string> = {}
async function actor(name: string, verified = true) {
  const id = `${prefix}-${name}`
  const token = `${prefix}-token-${name}`
  await admin`INSERT INTO "user" (id,name,email,email_verified) VALUES (${id},${name},${`${id}@example.test`},${verified})`
  await admin`INSERT INTO session (id,token,user_id,expires_at) VALUES (${`${id}-session`},${token},${id},now()+interval '1 hour')`
  actorIds[name] = id
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return new Headers({ origin, 'content-type': 'application/json', cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` })
}
const routes: Record<string, string> = {
  createOrganization: 'create', updateOrganization: 'update', leaveOrganization: 'leave', removeMember: 'remove-member',
  updateMemberRole: 'update-member-role', createInvitation: 'invite-member', acceptInvitation: 'accept-invitation', rejectInvitation: 'reject-invitation', cancelInvitation: 'cancel-invitation', setActiveOrganization: 'set-active', deleteOrganization: 'delete',
}
type Result = { status: number, body: Record<string, unknown> }
async function call(mode: 'api' | 'http', name: string, headers: Headers, body: Record<string, unknown>): Promise<Result> {
  if (mode === 'http') {
    const response = await auth.handler(new Request(`${origin}/api/auth/organization/${routes[name]}`, { method: 'POST', headers, body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  try {
    const api = auth.api as unknown as Record<string, (input: { headers: Headers, body: Record<string, unknown> }) => Promise<Record<string, unknown>>>
    const method = api[name]
    assert(method)
    return { status: 200, body: await method({ headers, body }) }
  }
  catch (error) {
    assert(error && typeof error === 'object' && 'statusCode' in error && 'body' in error, `Unexpected failure class in ${name}: ${error instanceof Error ? error.name : 'unknown'}`)
    return { status: Number(error.statusCode), body: error.body as Record<string, unknown> }
  }
}
async function denied(promise: Promise<Result>, status: number) {
  const response = await promise
  assert.equal(response.status, status, `Unexpected safe outcome: ${String(response.body.code)}`)
  assert(!JSON.stringify(response.body).includes('SELECT'))
  return response
}
try {
  assert.deepEqual(resolveOrganizationsConfig({}), { organizationLimit: 10, membershipLimit: 100, invitationLimit: 100, invitationExpiresIn: 172800 })
  for (const value of ['0', '101', '1.0', '1e1', '-1', ' 1', '01']) assert.throws(() => resolveOrganizationsConfig({ ORGANIZATIONS_CREATION_LIMIT: value }))
  const owner = await actor('owner')
  const adminA = await actor('admin-a')
  const adminB = await actor('admin-b')
  const member = await actor('member')
  const stranger = await actor('stranger')
  const unverified = await actor('unverified', false)
  for (const mode of ['api', 'http'] as const) {
    const created = await call(mode, 'createOrganization', owner, { name: '  Fixture Organization  ', slug: `  ${prefix}-${mode}  ` })
    assert.equal(created.status, 200)
    assert.equal(created.body.name, 'Fixture Organization')
    const orgId = created.body.id as string
    const [ownerRow] = await admin`SELECT id,role FROM member WHERE organization_id=${orgId} AND user_id=${actorIds.owner!}`
    assert.equal(ownerRow?.role, 'owner')
    const context = await resolveTenantContext({ id: actorIds.owner! }, orgId, db)
    await assert.rejects(resolveTenantContextTx({ id: actorIds.owner! }, orgId, db), { code: 'invalid-input' })
    await assert.rejects(addOrganizationMember(auth, db, null, owner, { organizationId: orgId, userId: actorIds.stranger! }), { code: 'unauthenticated' })
    await assert.rejects(addOrganizationMember(auth, db, { id: actorIds.stranger! }, owner, { organizationId: orgId, userId: actorIds.stranger! }), { code: 'forbidden' })
    assert.equal(context.role, 'owner')
    assert(Object.isFrozen(context) && Object.isFrozen(context.scope))
    await assert.rejects(resolveTenantContext({ id: actorIds.stranger! }, orgId, db), { code: 'not-found' })
    await denied(call(mode, 'createOrganization', owner, { name: 'Bad', slug: 'bad---slug' }), 400)
    await denied(call(mode, 'createOrganization', owner, { name: 'Bad', slug: 'valid-slug', metadata: { owner: true } }), 400)
    await denied(call(mode, 'createOrganization', owner, { name: 'Duplicate', slug: `${prefix}-${mode}` }), 409)
    await denied(call(mode, 'leaveOrganization', owner, { organizationId: orgId }), 403)
    await denied(call(mode, 'removeMember', owner, { organizationId: orgId, memberIdOrEmail: ownerRow!.id }), 403)
    await denied(call(mode, 'updateMemberRole', owner, { organizationId: orgId, memberId: ownerRow!.id, role: 'member' }), 403)
    await denied(call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${prefix}-x@example.test`, role: 'owner' }), 403)
    await denied(call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${prefix}-x@example.test`, role: 'owner', resend: true }), 403)
    await denied(call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${prefix}-x@example.test`, role: 'member,owner' }), 400)
    await denied(call(mode, 'deleteOrganization', owner, { organizationId: orgId }), 422)
    for (const [name, headers, role] of [['admin-a', adminA, 'admin'], ['admin-b', adminB, 'admin'], ['member', member, 'member']] as const) {
      const invited = await call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${actorIds[name]}@example.test`, role })
      assert.equal(invited.status, 200)
      const accepted = await call(mode, 'acceptInvitation', headers, { invitationId: invited.body.id })
      assert.equal(accepted.status, 200)
    }
    const [adminRow] = await admin`SELECT id FROM member WHERE organization_id=${orgId} AND user_id=${actorIds['admin-b']!}`
    await denied(call(mode, 'updateMemberRole', adminA, { organizationId: orgId, memberId: adminRow!.id, role: 'member' }), 403)
    await denied(call(mode, 'removeMember', adminA, { organizationId: orgId, memberIdOrEmail: adminRow!.id }), 403)
    await denied(call(mode, 'createInvitation', adminA, { organizationId: orgId, email: `${prefix}-new@example.test`, role: 'admin' }), 403)
    await denied(call(mode, 'createInvitation', member, { organizationId: orgId, email: `${prefix}-new@example.test`, role: 'member' }), 403)
    const unverifiedInvite = await call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${actorIds.unverified}@example.test` })
    assert.equal(unverifiedInvite.status, 200)
    await denied(call(mode, 'acceptInvitation', unverified, { invitationId: unverifiedInvite.body.id }), 403)
    await denied(call(mode, 'acceptInvitation', stranger, { invitationId: unverifiedInvite.body.id }), 403)
    const newRecipient = await actor(`concurrent-${mode}`)
    const invite = await call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${actorIds[`concurrent-${mode}`]}@example.test` })
    assert.equal(invite.status, 200)
    const concurrent = await Promise.all([call(mode, 'acceptInvitation', newRecipient, { invitationId: invite.body.id }), call(mode, 'acceptInvitation', newRecipient, { invitationId: invite.body.id })])
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409])
    const [count] = await admin`SELECT count(*)::int AS count FROM member WHERE organization_id=${orgId} AND user_id=${actorIds[`concurrent-${mode}`]!}`
    assert.equal(count?.count, 1)
    const terminalRecipient = await actor(`terminal-${mode}`)
    for (const operation of ['cancelInvitation', 'rejectInvitation']) {
      const terminalInvite = await call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${actorIds[`terminal-${mode}`]}@example.test` })
      assert.equal(terminalInvite.status, 200)
      const headers = operation === 'cancelInvitation' ? owner : terminalRecipient
      assert.equal((await call(mode, operation, headers, { invitationId: terminalInvite.body.id })).status, 200)
      assert.equal((await call(mode, operation, headers, { invitationId: terminalInvite.body.id })).status, 200)
      await denied(call(mode, 'acceptInvitation', terminalRecipient, { invitationId: terminalInvite.body.id }), 409)
    }
    const failRecipient = await actor(`failure-${mode}`)
    const failedInvite = await call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${actorIds[`failure-${mode}`]}@example.test` })
    assert.equal(failedInvite.status, 200)
    await admin.unsafe(`CREATE FUNCTION reject_fixture_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = '${actorIds[`failure-${mode}`]}' THEN RAISE EXCEPTION 'fixture failure' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_fixture_admission BEFORE INSERT ON member FOR EACH ROW EXECUTE FUNCTION reject_fixture_admission()`)
    if (mode === 'api') await assert.rejects(auth.api.acceptInvitation({ headers: failRecipient, body: { invitationId: failedInvite.body.id as string } }))
    else {
      const failed = await auth.handler(new Request(`${origin}/api/auth/organization/accept-invitation`, { method: 'POST', headers: failRecipient, body: JSON.stringify({ invitationId: failedInvite.body.id }) }))
      assert.equal(failed.status, 503)
      assert(!(await failed.text()).includes('fixture failure'))
    }
    const [compensated] = await admin`SELECT status FROM invitation WHERE id=${failedInvite.body.id as string}`
    assert.equal(compensated?.status, 'pending')
    await assert.rejects(resolveTenantContext({ id: actorIds[`failure-${mode}`]! }, orgId, db), { code: 'not-found' })
    await admin`DROP TRIGGER reject_fixture_admission ON member`
    await admin`DROP FUNCTION reject_fixture_admission()`
    const expiryRecipient = await actor(`expiry-${mode}`)
    const expiryInvite = await call(mode, 'createInvitation', owner, { organizationId: orgId, email: `${actorIds[`expiry-${mode}`]}@example.test` })
    await admin`UPDATE invitation SET expires_at=now() WHERE id=${expiryInvite.body.id as string}`
    await denied(call(mode, 'acceptInvitation', expiryRecipient, { invitationId: expiryInvite.body.id }), 409)
    await admin`UPDATE invitation SET expires_at=now()+interval '1 hour',role='owner' WHERE id=${expiryInvite.body.id as string}`
    await denied(call(mode, 'acceptInvitation', expiryRecipient, { invitationId: expiryInvite.body.id }), 403)
    await admin`UPDATE invitation SET role='member,owner' WHERE id=${expiryInvite.body.id as string}`
    await denied(call(mode, 'acceptInvitation', expiryRecipient, { invitationId: expiryInvite.body.id }), 400)
    const [memberRow] = await admin`SELECT id FROM member WHERE organization_id=${orgId} AND user_id=${actorIds.member!}`
    assert.equal((await call(mode, 'setActiveOrganization', member, { organizationId: orgId })).status, 200)
    assert.equal((await call(mode, 'removeMember', owner, { organizationId: orgId, memberIdOrEmail: memberRow!.id })).status, 200)
    await assert.rejects(resolveTenantContext({ id: actorIds.member! }, orgId, db), { code: 'not-found' })
    assert((await listOrganizations({ id: actorIds.owner! }, db)).items.some(item => item.id === orgId))
    const members = await listMembers({ id: actorIds.owner! }, orgId, db, { limit: 1 })
    assert.equal(members.items.length, 1)
    assert(members.nextCursor)
    await assert.rejects(listMembers({ id: actorIds.owner! }, orgId, db, { cursor: `${members.nextCursor}=` }), { code: 'invalid-input' })
    await assert.rejects(listMembers({ id: actorIds.stranger! }, orgId, db), { code: 'not-found' })
    const crashStateId = `${prefix}-crash-${mode}`
    await admin`INSERT INTO invitation (id,organization_id,email,role,status,inviter_id,expires_at) VALUES (${crashStateId},${orgId},${`${actorIds.stranger}@example.test`},'member','accepted',${actorIds.owner!},now()+interval '1 hour')`
    const diagnosis = await diagnoseInvitation(db, crashStateId, async () => true, async () => actorIds.stranger!)
    assert.equal(diagnosis.state, 'accepted-without-membership')
    await assert.rejects(resolveTenantContext({ id: actorIds.stranger! }, orgId, db), { code: 'not-found' })
    await assert.rejects(diagnoseInvitation(db, crashStateId, undefined, async () => actorIds.stranger!), { code: 'forbidden' })
  }
  const failedSlug = `${prefix}-provisioning-failure`
  await admin.unsafe(`CREATE FUNCTION reject_fixture_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = '${actorIds.owner!}' THEN RAISE EXCEPTION 'fixture failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_fixture_owner BEFORE INSERT ON member FOR EACH ROW EXECUTE FUNCTION reject_fixture_owner()`)
  await assert.rejects(auth.api.createOrganization({ headers: owner, body: { name: 'Failed provisioning', slug: failedSlug } }))
  const [orphan] = await admin`SELECT id FROM organization WHERE slug=${failedSlug}`
  assert(orphan)
  await assert.rejects(resolveTenantContext({ id: actorIds.owner! }, orphan.id, db), { code: 'not-found' })
  await admin`DROP TRIGGER reject_fixture_owner ON member`
  await admin`DROP FUNCTION reject_fixture_owner()`
  await assert.rejects(auth.api.addMember({ headers: owner, body: { organizationId: 'probe-organization', userId: actorIds.stranger!, role: 'owner' } }))
}
finally {
  await admin.end()
  if (driver === 'pg') await (client as pg.Pool).end()
  else await (client as ReturnType<typeof postgres>).end()
}
