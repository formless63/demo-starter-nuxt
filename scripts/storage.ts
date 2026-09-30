import { createStorage, StorageError } from '@repo/nuxt-storage/server'
import { smokeStorage } from '@repo/nuxt-storage/testing'
import { runStorageOperation } from '../server/utils/observed-storage'
import { initializeObservability, shutdownObservability } from '@repo/nuxt-observability/server'

initializeObservability({ serviceName: 'nuxt-starter-storage-check' })
const storage = createStorage({ runOperation: runStorageOperation })
try {
  if (Bun.argv[2] === 'check') await storage.checkStorage()
  else if (Bun.argv[2] === 'smoke') await smokeStorage(storage)
  else throw new StorageError('invalid-input')
  console.info('Storage verification passed')
}
catch (error) {
  console.error(error instanceof StorageError ? error.message : 'Storage verification failed')
  process.exitCode = 1
}
finally {
  storage.close()
  await shutdownObservability()
}
