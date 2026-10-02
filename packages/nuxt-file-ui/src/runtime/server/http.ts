import { createError, getQuery, getRequestHeader, setResponseHeaders, type H3Event } from 'h3'
import { FileError, type FileContext } from '../contract'
import type { createFileWorkflow } from './workflow'

/** Native Node/Nitro stream. h3 1.15 getRequestWebStream queues without backpressure;
 * readRawBody may concatenate before a limit. Neither is used for file uploads. */
export function fileRequestBody(event: H3Event, maxBytes: number): ReadableStream<Uint8Array> {
  const length = getRequestHeader(event, 'content-length')
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new FileError('too_large')
  const req = event.node.req
  // This transport must be installed before body-parsing middleware. Already buffered
  // request adapters are unsupported rather than silently claiming ingest bounds.
  if (req.readableEncoding || 'rawBody' in req || 'body' in req || Symbol.for('h3RawBody') in req || event._requestBody || event.web?.request?.body) {
    throw new FileError('invalid_input')
  }
  let size = 0
  let dispose = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        req.pause()
        req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted)
      }
      const data = (chunk: unknown) => {
        req.pause()
        if (!(chunk instanceof Uint8Array)) { cleanup(); controller.error(new FileError('invalid_input')); return }
        size += chunk.byteLength
        if (size > maxBytes) { cleanup(); controller.error(new FileError('too_large')); return }
        controller.enqueue(chunk)
      }
      const end = () => { cleanup(); controller.close() }
      const error = () => { cleanup(); controller.error(new FileError('unavailable')) }
      const aborted = () => { cleanup(); controller.error(new FileError('cancelled')) }
      dispose = cleanup
      req.pause()
      req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', aborted)
    },
    pull() { req.resume() },
    cancel() { dispose() },
  }, { highWaterMark: 1 })
}

/** Application supplies authenticated identity and a configured trusted origin.
 * No owner/key or reconciliation attestation is accepted from HTTP input. */
export function createFileHttpHandler(options: {
  workflow: ReturnType<typeof createFileWorkflow>
  authenticate: (event: H3Event) => Promise<FileContext | null>
  origin: (event: H3Event) => string
}) {
  return async (event: H3Event, path: 'list' | 'upload' | 'remove' | 'download') => {
    const disconnect = new AbortController()
    let streaming = false
    let uploadBody: ReadableStream<Uint8Array> | undefined
    const cleanup = () => {
      event.node.req.off('aborted', onAbort)
      event.node.res.off('close', onClose)
      event.node.res.off('finish', cleanup)
    }
    const onAbort = () => disconnect.abort()
    const onClose = () => { if (!event.node.res.writableFinished) disconnect.abort(); cleanup() }
    event.node.req.once('aborted', onAbort)
    event.node.res.once('close', onClose)
    setResponseHeaders(event, { 'Cache-Control': 'private, no-store' })
    try {
      const identity = await options.authenticate(event)
      if (!identity) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
      const ctx: FileContext = { owner: identity.owner, signal: AbortSignal.any([
        disconnect.signal, AbortSignal.timeout(30_000), ...(identity.signal ? [identity.signal] : []),
      ]) }
      const mutation = event.method === 'POST'
      if (mutation && (getRequestHeader(event, 'origin') !== new URL(options.origin(event)).origin || getRequestHeader(event, 'x-file-ui') !== '1')) throw new FileError('forbidden')
      const query = getQuery(event)
      if (Object.keys(query).some(key => key !== 'id') || (query.id !== undefined && typeof query.id !== 'string')) throw new FileError('invalid_input')
      const id = String(query.id ?? '')
      if (event.method === 'GET' && path === 'list') return await options.workflow.list(ctx)
      if (event.method === 'GET' && path === 'download') {
        const file = await options.workflow.download(ctx, id)
        // Native Response preserves streaming; Nitro owns body completion.
        const response = new Response(file.body.transformToWebStream(), { headers: file.headers })
        streaming = true
        event.node.res.once('finish', cleanup)
        return response
      }
      if (mutation && path === 'upload') {
        let name: string
        try { name = decodeURIComponent(getRequestHeader(event, 'x-file-name') ?? '') }
        catch { throw new FileError('invalid_input') }
        uploadBody = fileRequestBody(event, options.workflow.maxBytes)
        return await options.workflow.upload(ctx, {
          token: getRequestHeader(event, 'idempotency-key') ?? '', name,
          type: getRequestHeader(event, 'content-type') ?? '', body: uploadBody,
        })
      }
      if (mutation && path === 'remove') return await options.workflow.remove(ctx, id)
      throw new FileError('not_found')
    }
    catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 401) throw error
      const code = error instanceof FileError ? error.code : 'unavailable'
      const statusCode = { not_found: 404, forbidden: 403, conflict: 409, too_large: 413, invalid_input: 400, unavailable: 503, cancelled: 503 }[code]
      // Rejected unread uploads are never drained into memory.
      if (path === 'upload') setResponseHeaders(event, { Connection: 'close' })
      throw createError({ statusCode, statusMessage: code })
    }
    finally {
      // Validation may reject before workflow reads the body. Dispose even that
      // never-consumed stream so middleware cannot leave a dangling data listener.
      if (uploadBody && !uploadBody.locked) await uploadBody.cancel().catch(() => {})
      if (!streaming) cleanup()
    }
  }
}
