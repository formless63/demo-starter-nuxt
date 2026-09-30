import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { smokeStorage } from '@repo/nuxt-storage/testing'
import { compose, startProvider } from './providers'

// Installing the module must not turn Storage configuration into a boot requirement.
const backendlessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('STORAGE_') && !key.startsWith('AWS_')))
const backendless = Bun.spawn(['node', '.output/server/index.mjs'], {
  env: { ...backendlessEnv, PORT: '3198', HOST: '127.0.0.1' }, stdout: 'pipe', stderr: 'pipe',
})
try {
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      assert.equal((await fetch('http://127.0.0.1:3198/')).status, 200)
      ready = true
      break
    }
    catch { await Bun.sleep(250) }
  }
  assert(ready, 'Installed Storage module boots without backend, bucket or region when unused')
  console.info('[storage] backendless production boot passed')
}
finally { backendless.kill('SIGTERM'); await backendless.exited }

for (const provider of ['rustfs', 'garage'] as const) {
  const project = `storage-test-${provider}-${randomUUID().slice(0, 8)}`
  let server: ReturnType<typeof Bun.spawn> | undefined
  let backend: Awaited<ReturnType<typeof startProvider>> | undefined
  try {
    backend = await startProvider(provider, project, true, provider === 'garage')
    assert.deepEqual(await smokeStorage(backend.storage), { ok: true })
    const { config, env } = backend
    const cors = await fetch(`${config.endpoint}/${config.bucket}/cors-probe`, {
      method: 'OPTIONS', headers: { 'origin': 'http://localhost:3000', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
    })
    assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:3000')
    const untrusted = await fetch(`${config.endpoint}/${config.bucket}/cors-probe`, {
      method: 'OPTIONS', headers: { 'origin': 'https://untrusted.invalid', 'access-control-request-method': 'PUT' },
    })
    assert.notEqual(untrusted.headers.get('access-control-allow-origin'), 'https://untrusted.invalid')
    if (provider === 'garage') {
      const address = await compose(project, ['port', 'garage-ui', '8080'], env)
      let response: Response | undefined
      for (let attempt = 0; attempt < 40; attempt++) {
        try { response = await fetch(`http://${address}/health`); if (response.ok) break }
        catch { await Bun.sleep(250) }
      }
      assert(response && response.ok, 'Noooste Garage UI health')
      assert.equal((await fetch(`http://${address}/`)).status, 200, 'UI frontend reachability')
      const authConfig = await (await fetch(`http://${address}/auth/config`)).json()
      assert.equal(authConfig.token.enabled, true, 'Operator token authentication is enabled')
      assert(!JSON.stringify(authConfig).includes('local-only-garage-admin-change-me'), 'Public auth configuration must not expose admin credentials')
      assert.equal((await fetch(`http://${address}/api/v1/cluster/status`)).status, 401, 'Admin API requires authentication')
      for (const token of ['', 'wrong', config.secretAccessKey]) {
        const failedLogin = await fetch(`http://${address}/auth/login-token`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
        })
        assert.equal(failedLogin.status, 401, 'Empty/wrong/S3 credentials cannot authenticate as a Garage administrator')
      }
      const login = await fetch(`http://${address}/auth/login-token`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'local-only-garage-admin-change-me' }),
      })
      assert.equal(login.status, 200)
      const session = await login.json()
      assert.equal(session.success, true)
      assert(session.token && session.token !== 'local-only-garage-admin-change-me', 'UI login returns a separate signed session token')
      const cluster = await fetch(`http://${address}/api/v1/cluster/status`, { headers: { authorization: `Bearer ${session.token}` } })
      assert.equal(cluster.status, 200, 'UI admin proxy must reach Garage 2.4.1')
      const status = await cluster.json()
      assert.equal(status.success, true)
      assert(status.data, 'Successful admin API response contains cluster status')
      console.info('[storage] Noooste Garage UI v0.13.0 health, token authentication and Garage 2.4.1 admin API passed')
    }
    // Prove the installed module's server auto-import in actual production Node output.
    server = Bun.spawn(['node', '.output/server/index.mjs'], {
      env: { ...process.env, PORT: '3198', HOST: '127.0.0.1', STORAGE_BUCKET: config.bucket, STORAGE_ENDPOINT: config.endpoint,
        STORAGE_REGION: config.region, STORAGE_ACCESS_KEY_ID: config.accessKeyId, STORAGE_SECRET_ACCESS_KEY: config.secretAccessKey },
      stdout: 'pipe', stderr: 'pipe',
    })
    let healthy = false
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:3198/api/check')
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { ok: true })
        healthy = true
        break
      }
      catch { await Bun.sleep(250) }
    }
    assert(healthy, 'Installed storage module must load and operate')
    console.info(`[storage] ${provider} common S3 contract, CORS and module runtime passed`)
  }
  finally {
    server?.kill('SIGTERM')
    if (server) await server.exited
    backend?.storage.close()
    await compose(project, ['--profile', provider, '--profile', 'garage-ui', 'down', '--volumes', '--remove-orphans'])
  }
}
