import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { createProbeSchema } from './probe-database.ts'

// Read only the supplied local service; own and delete only this uniquely named DB.
const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'DATABASE_URL for a disposable local PostgreSQL service is required')
const serviceUrl = new URL(databaseUrl)
assert(['localhost', '127.0.0.1', '[::1]'].includes(serviceUrl.hostname), 'Probe permits loopback services only')
const admin = postgres(databaseUrl, { max: 1 })
const databaseName = `organizations_atomicity_${crypto.randomUUID().replaceAll('-', '')}`
serviceUrl.pathname = `/${databaseName}`
const observer = postgres(serviceUrl.toString(), { max: 1 })
const enclosingTransaction = process.env.ORGANIZATIONS_PROBE_ENCLOSING_TRANSACTION === 'true'
const dispatchPath = resolve(import.meta.dirname, 'upstream-dispatch.ts')
let created = false
let held = false
let child: ReturnType<typeof Bun.spawn> | undefined

async function readState() {
  const [result] = await observer`
    SELECT (SELECT status FROM invitation WHERE id = 'probe-invitation') AS status,
           (SELECT count(*)::int FROM member WHERE user_id = 'probe-recipient') AS members`
  assert(result)
  return result
}

try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  created = true
  const [version] = await observer`SHOW server_version_num`
  assert(version && Number(version.server_version_num) >= 180000 && Number(version.server_version_num) < 190000, 'PostgreSQL 18 is required')
  await createProbeSchema(observer)

  for (const runtime of ['bun', 'node'] as const) {
    for (const driver of ['postgres-js', 'pg'] as const) {
      for (const dispatch of ['api', 'http'] as const) {
        for (const scenario of ['complete', 'crash'] as const) {
          await observer`DELETE FROM member WHERE user_id = 'probe-recipient'`
          await observer`DELETE FROM invitation`
          await observer`INSERT INTO invitation (id,organization_id,email,role,status,inviter_id,expires_at) VALUES ('probe-invitation','probe-organization','recipient@example.test','member','pending','probe-owner',now() + interval '1 hour')`
          await observer`SELECT pg_advisory_lock(7462,99)`
          held = true
          child = Bun.spawn([runtime, dispatchPath], {
            cwd: process.cwd(),
            env: { ...process.env, ORGANIZATIONS_PROBE_DATABASE_URL: serviceUrl.toString(), ORGANIZATIONS_PROBE_DRIVER: driver, ORGANIZATIONS_PROBE_DISPATCH: dispatch },
            stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
          })
          // Bound the observation itself. The test does not use a timeout as an I/O cancellation claim.
          const deadline = Date.now() + 15000
          let blocked = false
          while (Date.now() < deadline) {
            assert(child.exitCode === null, 'Native auth dispatch exited before member transaction barrier')
            const [waiting] = await observer`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND wait_event = 'advisory'`
            if (waiting && waiting.count > 0) {
              blocked = true
              break
            }
            await Bun.sleep(25)
          }
          assert(blocked, 'Member transaction did not reach fixture barrier')
          const during = await readState()
          const atomic = enclosingTransaction && dispatch === 'api'
          assert.equal(during.status, atomic ? 'pending' : 'accepted', 'Claim visibility must match the transaction boundary')
          assert.equal(during.members, 0, 'Expected membership insertion to remain uncommitted')
          if (scenario === 'crash') {
            // Kill only our own auth child while membership is blocked; no after-error compensation can run.
            child.kill('SIGKILL')
            await child.exited
          }
          await observer`SELECT pg_advisory_unlock(7462,99)`
          held = false
          if (scenario === 'complete') assert.equal(await child.exited, 0, 'Native auth dispatch did not complete normally')
          child = undefined
          const after = await readState()
          assert.equal(after.status, atomic && scenario === 'crash' ? 'pending' : 'accepted')
          assert.equal(after.members, scenario === 'complete' ? 1 : 0)
          console.info(`[organizations upstream probe] ${runtime}/${driver}/${dispatch}/${scenario}: ${enclosingTransaction ? 'enclosing transaction' : 'upstream transaction'}; final status=${after.status}, members=${after.members}`)
        }
      }
    }
  }
  console.info(enclosingTransaction
    ? '[organizations upstream probe] Confirmed enclosing context fixes auth.api, but native HTTP resets it; HTTP atomicity gate remains blocked.'
    : '[organizations upstream probe] All 16 cases confirmed upstream non-atomic acceptance.')
}
finally {
  if (child) {
    child.kill('SIGKILL')
    await child.exited
  }
  if (held) await observer`SELECT pg_advisory_unlock(7462,99)`
  await observer.end()
  if (created) await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
  await admin.end()
}
