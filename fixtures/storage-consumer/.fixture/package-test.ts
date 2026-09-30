import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { smokeStorage } from '@repo/nuxt-storage/testing'
import { compose, startProvider } from './providers'

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
      const address = await compose(project, ['port', 'garage-ui', '3909'], env)
      let response: Response | undefined
      for (let attempt = 0; attempt < 40; attempt++) {
        try { response = await fetch(`http://${address}`); break }
        catch { await Bun.sleep(250) }
      }
      assert(response && response.ok, 'Garage UI reachability')
      assert.equal((await fetch(`http://${address}/api/config`)).status, 401, 'UI admin configuration requires authentication')
      const failedLogin = await fetch(`http://${address}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'operator', password: 'wrong' }),
      })
      assert.equal(failedLogin.status, 401)
      const login = await fetch(`http://${address}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'operator', password: 'local-ui-dev-only' }),
      })
      assert.equal(login.status, 200)
      const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
      assert(cookie, 'UI login establishes operator session')
      const cluster = await fetch(`http://${address}/api/v2/GetClusterStatus`, { headers: { cookie } })
      assert.equal(cluster.status, 200, 'UI admin proxy must reach the configured Garage v2 API')
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
    await compose(project, ['--profile', provider, '--profile', 'garage-ui', 'down', '--volumes', '--remove-orphans'], {
      GARAGE_UI_AUTH: backend?.env.GARAGE_UI_AUTH ?? 'unused:unused',
    })
  }
}
