import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { CreateBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import { createStorage } from '@repo/nuxt-storage/server'

export type Provider = 'rustfs' | 'garage'
const composeFile = fileURLToPath(new URL('./compose.yaml', import.meta.url))
const docker = process.env.STORAGE_DOCKER_SUDO === 'true'
  ? ['sudo', '-n', '--preserve-env=RUSTFS_PORT,RUSTFS_CONSOLE_PORT,GARAGE_PORT,GARAGE_UI_PORT,GARAGE_UI_AUTH,STORAGE_DEV_ACCESS_KEY,STORAGE_DEV_SECRET_KEY,STORAGE_DEV_BUCKET,STORAGE_DEV_ORIGIN,GARAGE_DEV_ACCESS_KEY', 'docker']
  : ['docker']

export async function compose(project: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = Bun.spawn([...docker, 'compose', '-p', project, '-f', composeFile, '--profile', 'rustfs', '--profile', 'garage', '--profile', 'garage-ui', ...args], {
    env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exit) throw new Error(`Storage development infrastructure failed (${args[0]}): ${stderr}`)
  return stdout.trim()
}

export async function startProvider(provider: Provider, project: string, temporary = false, ui = false) {
  const env = {
    RUSTFS_PORT: temporary ? '0' : process.env.RUSTFS_PORT ?? '9000',
    RUSTFS_CONSOLE_PORT: temporary ? '0' : process.env.RUSTFS_CONSOLE_PORT ?? '9001',
    GARAGE_PORT: temporary ? '0' : process.env.GARAGE_PORT ?? '3900',
    GARAGE_UI_PORT: temporary ? '0' : process.env.GARAGE_UI_PORT ?? '3909',
    GARAGE_UI_AUTH: process.env.GARAGE_UI_AUTH ?? `operator:${await Bun.password.hash('local-ui-dev-only', { algorithm: 'bcrypt', cost: 10 })}`,
  }
  const profiles = ['--profile', provider, ...(ui ? ['--profile', 'garage-ui'] : [])]
  await compose(project, [...profiles, 'up', '-d', ...(ui ? [provider, 'garage-ui'] : [provider])], env)
  const address = await compose(project, ['port', provider, provider === 'rustfs' ? '9000' : '3900'], env)
  const config = {
    bucket: process.env.STORAGE_DEV_BUCKET ?? 'starter-storage',
    region: provider === 'rustfs' ? 'us-east-1' : 'garage',
    endpoint: `http://${address}`,
    accessKeyId: provider === 'rustfs' ? process.env.STORAGE_DEV_ACCESS_KEY ?? 'starter-storage-dev' : process.env.GARAGE_DEV_ACCESS_KEY ?? 'GK0123456789abcdef0123456789abcdef',
    secretAccessKey: process.env.STORAGE_DEV_SECRET_KEY ?? 'local-only-storage-secret-change-me',
    env: {},
  }
  const storage = createStorage(config)
  const deadline = Date.now() + 90000
  let ready = false
  while (Date.now() < deadline) {
    try {
      if (provider === 'rustfs') {
        try { await storage.getS3Client().send(new CreateBucketCommand({ Bucket: config.bucket })) }
        catch (error) {
          if (!['BucketAlreadyExists', 'BucketAlreadyOwnedByYou'].includes((error as Error).name)) throw error
        }
      }
      await storage.checkStorage()
      ready = true
      break
    }
    catch { await Bun.sleep(500) }
  }
  if (!ready) throw new Error(`Storage ${provider} bootstrap did not become ready`)
  // Garage implements bucket CORS. RustFS additionally has listener origin config.
  await storage.getS3Client().send(new PutBucketCorsCommand({
    Bucket: config.bucket,
    CORSConfiguration: { CORSRules: [{
      AllowedOrigins: [process.env.STORAGE_DEV_ORIGIN ?? 'http://localhost:3000'],
      AllowedMethods: ['GET', 'PUT', 'HEAD'],
      AllowedHeaders: ['content-type', 'cache-control', 'x-amz-meta-purpose'],
      ExposeHeaders: ['ETag'], MaxAgeSeconds: 600,
    }] },
  }))
  return { storage, config, env, composeFile: resolve(composeFile) }
}
