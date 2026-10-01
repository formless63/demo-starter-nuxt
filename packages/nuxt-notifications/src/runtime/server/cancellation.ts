import { NotificationError } from './errors'

/** Cancel preparation only. Late resolution/rejection is handled; no I/O undo is claimed. */
export function checkNotificationCancellation(signal: AbortSignal) {
  if (signal.aborted) throw new NotificationError('timeout')
}
export function resolveNotificationTarget<T>(signal: AbortSignal, resolve: () => Promise<T>): Promise<T> {
  checkNotificationCancellation(signal)
  return new Promise<T>((accept, reject) => {
    const abort = () => reject(new NotificationError('timeout'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { checkNotificationCancellation(signal); return resolve() }).then(
      value => { signal.removeEventListener('abort', abort); accept(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}
