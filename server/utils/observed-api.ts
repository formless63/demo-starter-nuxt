import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { defineEventHandler, getResponseStatus } from 'h3'
import { defineApiHandler } from '@repo/nuxt-api/server'
import { captureException, observeOperation } from '@repo/nuxt-observability/server'

/** Application-owned optional integration; neither package depends on the other. */
export function defineObservedApiHandler<Request extends EventHandlerRequest, Response>(
  operationId: string, handler: EventHandler<Request, Response>,
) {
  const apiHandler = defineApiHandler(async (event: H3Event<Request>) => {
    try { return await handler(event) }
    catch (error) {
      const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 500
      if (status >= 500) captureException(error)
      throw error // The existing API package still owns status/envelope semantics.
    }
  })
  return defineEventHandler(event => observeOperation('api', operationId, () => apiHandler(event),
    { 'http.request.method': event.method }, () => getResponseStatus(event)))
}
