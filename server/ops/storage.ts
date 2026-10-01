import { createStorage, type Storage } from '@repo/nuxt-storage/server'

// Separate lazy caller-owned client: diagnostics never change ordinary Storage retries.
let storage: Storage | undefined
export async function inspectOpsStorage() {
  storage ??= createStorage({ maxAttempts: 1 })
  await storage.checkStorage()
  return { status: 'ok' as const }
}
export function closeOpsStorage() { storage?.close(); storage = undefined }
