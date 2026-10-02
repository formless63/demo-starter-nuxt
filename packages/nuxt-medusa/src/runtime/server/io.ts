import { MedusaError } from './errors'
export function deadline(maxMs: number, parents: (AbortSignal | undefined)[] = [], shortenMs = maxMs) {
  if (!Number.isFinite(shortenMs) || shortenMs <= 0 || shortenMs > maxMs) throw new MedusaError('invalid_input')
  const controller = new AbortController(), end = Date.now() + shortenMs
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, shortenMs)
  const abort = () => controller.abort()
  for (const parent of parents) { parent?.addEventListener('abort', abort, { once: true }); if (parent?.aborted) abort() }
  return {
    signal: controller.signal,
    remaining: () => Math.max(0, end - Date.now()),
    check() { if (timedOut || Date.now() >= end) throw new MedusaError('deadline_exceeded'); if (controller.signal.aborted) throw new MedusaError('cancelled') },
    close() { clearTimeout(timer); for (const parent of parents) parent?.removeEventListener('abort', abort) },
  }
}
export type Deadline = ReturnType<typeof deadline>
/** Also races a non-cooperative transport/stream; native fetch receives this same signal. */
export async function cancellable<T>(work: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw new MedusaError('cancelled')
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new MedusaError('cancelled')); signal.addEventListener('abort', abort, { once: true }) })
  try { return await Promise.race([work, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}
export async function readBytes(body: ReadableStream<Uint8Array> | null, maxBytes: number, budget: Deadline) {
  if (!body) return Buffer.alloc(0)
  const reader = body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  budget.signal.addEventListener('abort', abort, { once: true })
  try {
    budget.check()
    while (true) {
      const part = await cancellable(reader.read(), budget.signal); budget.check()
      if (part.done) break
      size += part.value.byteLength
      if (size > maxBytes) throw new MedusaError('limit_exceeded')
      chunks.push(part.value)
    }
    return Buffer.concat(chunks, size)
  }
  catch (error) { abort(); budget.check(); throw error }
  finally { budget.signal.removeEventListener('abort', abort); reader.releaseLock() }
}
export function checkLength(headers: Headers, max: number) {
  const length = headers.get('content-length')
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > max)) throw new MedusaError('limit_exceeded')
}
