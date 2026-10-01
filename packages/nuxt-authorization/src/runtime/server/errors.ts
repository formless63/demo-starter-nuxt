const messages = {
  configuration: 'Authorization configuration is invalid.', 'invalid-input': 'Authorization input is invalid.',
  unauthenticated: 'Authentication is required.', forbidden: 'Permission is denied.', 'not-found': 'Assignment was not found.',
  conflict: 'Authorization state conflicts with this operation.', timeout: 'Authorization operation timed out.',
  unavailable: 'Authorization dependency is unavailable.', unknown: 'Authorization operation failed.',
} as const
export type AuthorizationErrorCode = keyof typeof messages
export class AuthorizationError extends Error {
  readonly retryable: boolean
  constructor(readonly code: AuthorizationErrorCode) {
    super(messages[code])
    this.name = 'AuthorizationError'
    this.retryable = code === 'timeout' || code === 'unavailable'
  }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable } }
}
export function safeAuthorizationError(error: unknown) {
  if (error instanceof AuthorizationError) return error
  let cause = error
  for (let i = 0; i < 4 && cause && typeof cause === 'object'; i++) {
    if ('code' in cause) break
    cause = 'cause' in cause ? cause.cause : undefined
  }
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
  return new AuthorizationError(code === '57014' || code === '55P03' ? 'timeout' : code === '23505' ? 'conflict' : 'unavailable')
}
