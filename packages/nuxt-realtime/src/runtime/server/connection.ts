import { REALTIME_LIMITS, RealtimeError } from './errors'

/** The sink exposes current transport pressure; the queue includes the in-flight write. */
export interface RealtimeSink {
  bufferedBytes(): number
  write(frame: string): Promise<void>
  close(code: 'closed' | 'unavailable' | 'backpressure'): void
}
export function createRealtimeConnection(sink: RealtimeSink, onClosed: () => void) {
  const queue: Array<{ frame: string, bytes: number }> = []
  let pending = 0, running = false, closed = false
  let stalled: ReturnType<typeof setTimeout> | undefined
  const close = (code: 'closed' | 'unavailable' | 'backpressure' = 'closed') => {
    if (closed) return
    closed = true
    clearTimeout(stalled)
    queue.length = 0; pending = 0
    onClosed()
    sink.close(code)
  }
  const drain = async () => {
    if (running || closed) return
    running = true
    try {
      while (queue.length && !closed) {
        const next = queue.shift()!
        stalled = setTimeout(() => close('backpressure'), REALTIME_LIMITS.heartbeatMs)
        await sink.write(next.frame)
        clearTimeout(stalled)
        if (!closed) pending -= next.bytes
      }
    }
    catch { close('unavailable') }
    finally { running = false }
  }
  return {
    get closed() { return closed },
    get pendingBytes() { return pending },
    send(frame: string) {
      if (closed) throw new RealtimeError('closed')
      const bytes = Buffer.byteLength(frame)
      const transportBytes = sink.bufferedBytes()
      if (!Number.isFinite(transportBytes) || transportBytes < 0 || pending + transportBytes + bytes > REALTIME_LIMITS.pendingBytes) {
        close('backpressure')
        throw new RealtimeError('backpressure')
      }
      pending += bytes; queue.push({ frame, bytes })
      void drain()
    },
    close,
  }
}
