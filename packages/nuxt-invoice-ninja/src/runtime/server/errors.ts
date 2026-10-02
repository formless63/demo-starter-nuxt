export const errors = {
  invalid_input: [400, 'Invalid input.'], unauthenticated: [401, 'Authentication required.'],
  forbidden: [403, 'Access denied.'], not_found: [404, 'Resource not found.'],
  conflict: [409, 'Operation conflict.'], limit_exceeded: [413, 'Limit exceeded.'],
  unsupported: [422, 'Operation unsupported.'], unconfigured: [503, 'Integration is not configured.'],
  unavailable: [503, 'Integration unavailable.'], deadline_exceeded: [504, 'Operation deadline exceeded.'],
  cancelled: [409, 'Operation cancelled.'],
} as const
export type ErrorCode = keyof typeof errors
export class InvoiceNinjaError extends Error {
  readonly statusCode: number
  readonly retryable: boolean
  constructor(readonly code: ErrorCode, retryable = ['unavailable', 'deadline_exceeded'].includes(code)) {
    super(errors[code][1]); this.name = 'InvoiceNinjaError'; this.statusCode = errors[code][0]; this.retryable = retryable
  }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable } }
}
export function safeError(error: unknown, write = false) {
  return error instanceof InvoiceNinjaError ? new InvoiceNinjaError(error.code, write ? false : error.retryable) : new InvoiceNinjaError('unavailable', !write)
}
