import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { StorageOptions } from '@repo/nuxt-storage/server'
import type { Provider } from './providers'

export interface RetainedProvider {
  provider: Provider
  project: string
  config?: StorageOptions
  objects: { key: string, body: string, kind: 'file-ui' | 'independent-storage' }[]
}
const path = fileURLToPath(new URL('./retained-providers.json', import.meta.url))
export async function readState(): Promise<RetainedProvider[]> {
  try { return JSON.parse(await readFile(path, 'utf8')) as RetainedProvider[] }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
export async function writeState(providers: RetainedProvider[]) {
  await writeFile(path, `${JSON.stringify(providers, null, 2)}\n`, { mode: 0o600 })
}
