export type NotificationErrorCode = 'configuration' | 'invalid-input' | 'unavailable' | 'timeout' | 'rejected'
export class NotificationError extends Error {
  constructor(public readonly code: NotificationErrorCode, public readonly retryable = false) { super(`Notifications ${code}`); this.name = 'NotificationError' }
  toJSON() { return { name: this.name, code: this.code, retryable: this.retryable } }
}
