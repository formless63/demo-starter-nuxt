import { fileURLToPath } from 'node:url'

const composeFile = fileURLToPath(new URL('./compose.yaml', import.meta.url))
export async function compose(project: string, args: string[], port = '0', tlsCertDir?: string) {
  const child = Bun.spawn(['docker', 'compose', '-p', project, '-f', composeFile, ...(tlsCertDir ? ['-f', fileURLToPath(new URL('./compose.tls.yaml', import.meta.url))] : []), ...args], {
    env: { ...process.env, CACHE_DEV_PORT: port, ...(tlsCertDir ? { CACHE_TEST_CERT_DIR: tlsCertDir } : {}) }, stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exit) throw new Error(`Local Valkey infrastructure failed: ${stderr}`)
  return stdout.trim()
}
export async function startValkey(project: string, port = '0') {
  await compose(project, ['up', '-d', '--wait', 'valkey'], port)
  const address = await compose(project, ['port', 'valkey', '6379'], port)
  return `redis://${address}`
}
