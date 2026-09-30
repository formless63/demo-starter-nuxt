import { randomUUID } from 'node:crypto'
import { getHeader, getResponseStatus, setResponseHeader } from 'h3'
import { defineNitroPlugin, useEvent, useRuntimeConfig } from '#imports'
import { beginRequest, captureException, finishRequest, getLogger, initializeObservability,
  setRequestContextResolver, shutdownObservability, withLogContext } from './index'
import type { RequestContext } from './index'

const requestKey = 'observabilityRequest'
const methodOf = (method: string) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'].includes(method) ? method : '_OTHER'

export default defineNitroPlugin((nitro) => {
  initializeObservability(useRuntimeConfig().observability)
  setRequestContextResolver(() => {
    try { return useEvent().context[requestKey] as RequestContext | undefined }
    catch { return undefined }
  })
  nitro.hooks.hook('request', (event) => {
    const incoming = getHeader(event, 'x-request-id')
    const requestId = incoming && /^[a-zA-Z0-9_-]{1,64}$/.test(incoming) ? incoming : randomUUID()
    const request = beginRequest(requestId, methodOf(event.method), getHeader(event, 'traceparent'))
    event.context[requestKey] = request
    setResponseHeader(event, 'X-Request-ID', requestId)
    withLogContext({ requestId }, () => getLogger().info({ 'http.request.method': methodOf(event.method) }, 'request.started'))
  })
  nitro.hooks.hook('afterResponse', (event) => {
    const request = event.context[requestKey] as RequestContext | undefined
    if (!request) return
    // H3's registered route template, never event.path (which contains arbitrary IDs/query data).
    const route = event.context.matchedRoute?.path ?? 'unmatched'
    finishRequest(request, methodOf(event.method), route, getResponseStatus(event))
  })
  nitro.hooks.hook('error', (error, { event }) => {
    const request = event?.context[requestKey] as RequestContext | undefined
    withLogContext(request ? { requestId: request.requestId, ...request.span.spanContext() } : {}, () => captureException(error, request?.span))
  })
  nitro.hooks.hookOnce('close', shutdownObservability)
})
