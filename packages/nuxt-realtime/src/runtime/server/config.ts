import { RealtimeError } from './errors'
export type RealtimeTransport = 'sse' | 'websocket'
export function resolveRealtimeConfig(env: Record<string, string | undefined> = process.env) {
  const raw = env.REALTIME_TRANSPORTS ?? 'sse'
  const values = raw.toLowerCase().split(',').map(value => value.trim())
  if (!values.length || values.some(value => value !== 'sse' && value !== 'websocket') || new Set(values).size !== values.length) throw new RealtimeError('configuration')
  const transports: RealtimeTransport[] = (['sse', 'websocket'] as const).filter(value => values.includes(value))
  return { transports, normalized: transports.join(',') }
}
