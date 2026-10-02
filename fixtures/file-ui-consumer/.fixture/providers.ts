import { fileURLToPath } from 'node:url'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { createStorage, type StorageOptions } from '@repo/nuxt-storage/server'

export type Provider = 'rustfs' | 'garage'
const composeFile = fileURLToPath(new URL('./compose.yaml', import.meta.url))

export async function compose(project: string, args: string[]) {
  if (!/^file-ui-(rustfs|garage)-[a-f0-9-]+$/.test(project)) throw Error('Invalid disposable File UI project')
  const child = Bun.spawn(['docker', 'compose', '-p', project, '-f', composeFile, '--profile', 'rustfs', '--profile', 'garage', ...args], {
    stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exit) throw Error(`Required disposable File UI Docker provider failed (${args[0]}): ${stderr}`)
  return stdout.trim()
}

export async function startProvider(provider: Provider, project: string): Promise<StorageOptions> {
  await compose(project, ['up', '-d', provider])
  const address = await compose(project, ['port', provider, provider === 'rustfs' ? '9000' : '3900'])
  const config: StorageOptions = {
    bucket: 'file-ui-fixture', region: provider === 'rustfs' ? 'us-east-1' : 'garage',
    endpoint: `http://${address}`, accessKeyId: provider === 'rustfs' ? 'file-ui-synthetic-access' : 'GK0123456789abcdef0123456789abcdef',
    secretAccessKey: 'file-ui-synthetic-secret-only', env: {},
  }
  const storage = createStorage(config)
  try {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      try {
        if (provider === 'rustfs') {
          try { await storage.getS3Client().send(new CreateBucketCommand({ Bucket: config.bucket })) }
          catch (error) {
            if (!['BucketAlreadyExists', 'BucketAlreadyOwnedByYou'].includes((error as Error).name)) throw error
          }
        }
        await storage.checkStorage()
        return config
      }
      catch { await Bun.sleep(500) }
    }
    throw Error(`Required ${provider} provider did not become ready`)
  }
  finally { storage.close() }
}
