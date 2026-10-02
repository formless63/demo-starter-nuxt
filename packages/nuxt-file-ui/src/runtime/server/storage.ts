import { createStorage, type StorageOptions } from '@repo/nuxt-storage/server'
/** File workflow requires one physical PUT attempt. Ordinary Storage keeps its defaults. */
export function createFileStorage(options: StorageOptions = {}) {
  return createStorage({ ...options, maxAttempts: 1 })
}
