const errors = {
  invalid_input: ['Invalid input.', 400], unauthenticated: ['Authentication required.', 401],
  forbidden: ['Access denied.', 403], not_found: ['Resource not found.', 404],
  conflict: ['Operation conflict.', 409], limit_exceeded: ['Limit exceeded.', 413],
  unsupported: ['Operation unsupported.', 422], unconfigured: ['Integration is not configured.', 503],
  unavailable: ['Integration unavailable.', 503], deadline_exceeded: ['Operation deadline exceeded.', 504],
  cancelled: ['Operation cancelled.', 409],
} as const
export type ErrorCode = keyof typeof errors
export class StripeCapabilityError extends Error {
  readonly statusCode: number
  constructor(readonly code: ErrorCode) { super(errors[code][0]); this.statusCode = errors[code][1] }
  public(read = true) { return { code: this.code, message: this.message, retryable: read && ['unavailable', 'deadline_exceeded'].includes(this.code) } }
}
export function safeError(error: unknown) { return error instanceof StripeCapabilityError ? error : new StripeCapabilityError('unavailable') }
