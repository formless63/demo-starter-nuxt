export type RealtimeErrorCode = 'configuration' | 'invalid-input' | 'unauthorized' | 'unavailable' | 'closed' | 'backpressure'
export class RealtimeError extends Error {
  constructor(public readonly code: RealtimeErrorCode) { super(`Realtime ${code}`); this.name = 'RealtimeError' }
  toJSON() { return { name: this.name, code: this.code } }
}
export const REALTIME_LIMITS = Object.freeze({ eventBytes: 65_536, channels: 32, pendingBytes: 262_144, heartbeatMs: 20_000 })
