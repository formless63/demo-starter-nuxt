import { getCookie } from 'h3'
import { createFileHttpHandler, createFileStorage, createFileWorkflow, createMemoryFileMetadata } from '@repo/nuxt-file-ui/server'

// NON-DURABLE fixture ONLY. Bounded to 32 receipts, lost on process restart.
// Application authentication maps opaque synthetic session tokens to trusted owners;
// request bodies, names, query parameters and headers never supply an owner.
const metadata = createMemoryFileMetadata(32)
let storage: ReturnType<typeof createFileStorage> | undefined
const workflow = createFileWorkflow({
  metadata,
  storage: () => storage ??= createFileStorage(),
  authorize: async context => ['synthetic-alice', 'synthetic-bob'].includes(context.owner),
  maxBytes: 1024,
})
export const fileFixture = createFileHttpHandler({
  workflow,
  authenticate: async (event) => {
    const token = getCookie(event, 'file-fixture-session')
    if (process.env.FILE_UI_FIXTURE_ALICE && token === process.env.FILE_UI_FIXTURE_ALICE) return { owner: 'synthetic-alice' }
    if (process.env.FILE_UI_FIXTURE_BOB && token === process.env.FILE_UI_FIXTURE_BOB) return { owner: 'synthetic-bob' }
    return null
  },
  origin: () => process.env.FILE_UI_FIXTURE_ORIGIN ?? 'http://localhost:3000',
})
