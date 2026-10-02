import assert from 'node:assert/strict'
import { createServer } from 'node:net'

export async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert(address && typeof address !== 'string')
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

export async function startApp(extra: Record<string, string> = {}) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  // No developer credentials/provider settings may accidentally reach fixture IO.
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('STORAGE_') && !key.startsWith('AWS_') && !key.startsWith('FILE_UI_FIXTURE_')))
  const child = Bun.spawn(['node', '.output/server/index.mjs'], {
    env: { ...cleanEnv, ...extra, HOST: '127.0.0.1', PORT: String(port), FILE_UI_FIXTURE_ORIGIN: base },
    stdout: 'pipe', stderr: 'pipe',
  })
  let logs = ''
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        logs = (logs + new TextDecoder().decode(value)).slice(-8000)
      }
    }
    finally { reader.releaseLock() }
  }
  const readers = Promise.all([collect(child.stdout), collect(child.stderr)])
  async function stop() {
    if (child.exitCode === null) child.kill('SIGTERM')
    await Promise.race([child.exited, Bun.sleep(5000)])
    if (child.exitCode === null) child.kill('SIGKILL')
    await child.exited
    await readers
  }
  try {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        if ((await fetch(base, { signal: AbortSignal.timeout(1500) })).ok) return { base, stop }
      }
      catch { /* readiness is retried, test assertions are not */ }
      await Bun.sleep(250)
    }
    throw Error(`Packed Nitro production fixture did not start: ${logs}`)
  }
  catch (error) { await stop(); throw error }
}
