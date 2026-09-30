import { boundedInteger, WebhookError } from './errors'

export async function runBounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal) {
  boundedInteger(timeoutMs, 100, 30_000)
  const controller = new AbortController()
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new WebhookError('timeout', true))
    if (signal.aborted) rejectAbort()
    else signal.addEventListener('abort', rejectAbort, { once: true })
  })
  try {
    if (signal.aborted) throw new WebhookError('timeout', true)
    return await Promise.race([operation(signal), aborted])
  }
  finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', rejectAbort)
  }
}
