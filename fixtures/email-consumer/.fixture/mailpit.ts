import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer, createConnection } from 'node:net'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'

const exec = promisify(execFile)
export async function startMailpit() {
  const name = `email-test-${randomUUID()}`
  const docker = async (args: string[]) => (await exec('docker', args, { timeout: 60000 })).stdout.trim()
  try {
    await docker(['run', '-d', '--name', name, '-p', '127.0.0.1::1025', '-p', '127.0.0.1::8025',
      '-e', 'MP_MAX_MESSAGES=100', '-e', 'MP_ALLOWED_HOSTS=127.0.0.1,localhost', '-e', 'MP_BLOCK_REMOTE_CSS_AND_FONTS=true',
      '-e', 'MP_DISABLE_VERSION_CHECK=true', '-e', 'MP_SMTP_DISABLE_RDNS=true', '-e', 'MP_ENABLE_CHAOS=true',
      '-e', 'MP_SMTP_AUTH=fixture:fixture', '-e', 'MP_SMTP_AUTH_ALLOW_INSECURE=true',
      '-e', 'MP_SMTP_ALLOWED_RECIPIENTS=^[^@]+@example\\.test$', 'axllent/mailpit:v1.31.3'])
    const smtp = await docker(['port', name, '1025'])
    const http = `http://${await docker(['port', name, '8025'])}`
    const api = async (path: string, options?: RequestInit) => {
      const response = await fetch(`${http}/api/v1/${path}`, options)
      assert(response.ok, 'Disposable Mailpit API request succeeds')
      return response.status === 204 ? undefined : response.json()
    }
    let ready = false
    for (let i = 0; i < 80; i++) {
      try { await api('messages'); ready = true; break }
      catch { await new Promise(resolve => setTimeout(resolve, 200)) }
    }
    assert(ready, 'Disposable SMTP fixture starts')
    const connections: string[] = []
    const sockets = new Set<ReturnType<typeof createConnection>>()
    const proxy = createServer((client) => {
      const index = connections.push('') - 1
      const upstream = createConnection({ host: '127.0.0.1', port: Number(smtp.split(':').at(-1)) })
      for (const socket of [client, upstream]) {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => { client.destroy(); upstream.destroy() })
      }
      client.on('data', (chunk) => { connections[index] = (connections[index] + chunk.toString()).slice(0, 2 * 1024 * 1024) })
      client.pipe(upstream); upstream.pipe(client)
    })
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
    return { name, api, connections, port: (proxy.address() as AddressInfo).port,
      async chaos(code?: number, stage = 'Sender') { await api('chaos', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(code ? { [stage]: { ErrorCode: code, Probability: 100 } } : {}) }) },
      async messages() { return (await api('messages')).messages as { ID: string }[] },
      async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => proxy.close(() => resolve())); await docker(['rm', '-f', name]) },
    }
  }
  catch (error) { await docker(['rm', '-f', name]).catch(() => {}); throw error }
}
export function mailpitEnv(port: number) {
  return { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURITY: 'opportunistic', SMTP_USER: 'fixture', SMTP_PASSWORD: 'fixture',
    EMAIL_FROM_ADDRESS: 'starter@example.test', EMAIL_FROM_NAME: 'Stärtér', EMAIL_REPLY_TO_ADDRESS: 'reply@example.test', EMAIL_REPLY_TO_NAME: 'Reply', EMAIL_MAX_RECIPIENTS: '50' }
}
