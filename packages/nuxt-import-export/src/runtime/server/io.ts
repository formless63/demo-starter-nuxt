import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { TransferError } from './errors'
export async function boundedBody(body: AsyncIterable<Uint8Array>, maxBytes: number, signal: AbortSignal) {
  if (signal.aborted) throw new TransferError('cancelled')
  const stream = body as Readable
  const abort = () => { stream.destroy?.(new TransferError('cancelled')) }
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Buffer[] = [], hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of body) {
      if (signal.aborted) throw new TransferError('cancelled')
      if (!(chunk instanceof Uint8Array)) throw new TransferError('invalid-format')
      bytes += chunk.byteLength
      if (bytes > maxBytes) throw new TransferError('limit-exceeded')
      const copy = Buffer.from(chunk); chunks.push(copy); hash.update(copy)
    }
    return { body: Buffer.concat(chunks, bytes), hash: hash.digest('hex'), bytes }
  }
  finally { signal.removeEventListener('abort', abort); stream.destroy?.() }
}
export function attemptDeadline(seconds: number, parent?: AbortSignal) {
  const controller = new AbortController(), end = Date.now() + seconds * 1000
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, seconds * 1000)
  const abort = () => controller.abort()
  parent?.addEventListener('abort', abort, { once: true })
  if (parent?.aborted) abort()
  return {
    signal: controller.signal,
    check() { if (timedOut || Date.now() >= end) throw new TransferError('timeout'); if (controller.signal.aborted) throw new TransferError('cancelled') },
    remaining() { return Math.max(0, end - Date.now()) },
    isTimeout() { return timedOut || Date.now() >= end },
    close() { clearTimeout(timer); parent?.removeEventListener('abort', abort) },
  }
}
