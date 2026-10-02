import { createStorage } from '@repo/nuxt-storage/server'
import { compose } from './providers'
import { readState, writeState } from './state'

const failures: unknown[] = []
for (const provider of await readState()) {
  try {
    if (provider.config) {
      const storage = createStorage(provider.config)
      try { for (const object of provider.objects) await storage.deleteObject(object.key) }
      finally { storage.close() }
    }
  }
  catch (error) { failures.push(error) }
  finally {
    try { await compose(provider.project, ['down', '--volumes', '--remove-orphans']) }
    catch (error) { failures.push(error) }
  }
}
if (failures.length) throw new AggregateError(failures, 'Disposable File UI provider cleanup failed')
await writeState([])
