import { createStorage } from '@repo/nuxt-storage/server'
import type { StorageOperationRunner } from '@repo/nuxt-storage/server'
import { getLogger, getMeter, withSpan } from '@repo/nuxt-observability/server'

// This application-owned integration is optional; the package has no OTel imports.
export const runStorageOperation: StorageOperationRunner = (operation, action, bytes) => withSpan(`storage.${operation}`, async () => {
  const start = performance.now()
  let outcome = 'success'
  try { return await action() }
  catch (error) { outcome = 'error'; throw error }
  finally {
    const attributes = { 'app.storage.operation': operation, 'app.storage.outcome': outcome }
    const duration = (performance.now() - start) / 1000
    getMeter().createHistogram('app.storage.operation.duration', { unit: 's' }).record(duration, attributes)
    if (bytes !== undefined) getMeter().createHistogram('app.storage.operation.bytes', { unit: 'By' }).record(bytes, attributes)
    getLogger().info({ operation, outcome, duration, bytes }, 'storage.operation')
  }
})

let applicationStorage: ReturnType<typeof createStorage> | undefined
export function getObservedStorage() { return applicationStorage ??= createStorage({ runOperation: runStorageOperation }) }
export function closeObservedStorage() { applicationStorage?.close(); applicationStorage = undefined }
