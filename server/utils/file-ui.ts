import { createFileHttpHandler, createFileStorage, createFileWorkflow } from '@repo/nuxt-file-ui/server'
import { createPostgresFileMetadata } from './file-ui-metadata'
import { useDb } from './db'
import { requireUser } from './session'
let handler: ReturnType<typeof createFileHttpHandler> | undefined
export function useFileHttpHandler() {
  if (!handler) {
    const storage = createFileStorage()
    handler = createFileHttpHandler({
      workflow: createFileWorkflow({ metadata: createPostgresFileMetadata(useDb()), storage: () => storage, authorize: async ctx => Boolean(ctx.owner) }),
      authenticate: async event => ({ owner: (await requireUser(event)).id }),
      origin: () => useRuntimeConfig().public.appBaseUrl,
    })
  }
  return handler
}
