const messages = {
  configuration: 'FeatureFlags configuration is invalid.', 'invalid-input': 'FeatureFlags input is invalid.',
  unauthenticated: 'Authentication is required.', forbidden: 'Permission is denied.', 'not-found': 'Feature flag was not found.',
  conflict: 'FeatureFlags state conflicts with this operation.', timeout: 'FeatureFlags operation timed out.',
  unavailable: 'FeatureFlags dependency is unavailable.', unknown: 'FeatureFlags operation failed.',
} as const
export type FeatureFlagsErrorCode = keyof typeof messages
export class FeatureFlagsError extends Error {
  readonly retryable: boolean
  constructor(readonly code: FeatureFlagsErrorCode) {
    super(messages[code])
    this.name = 'FeatureFlagsError'
    this.retryable = code === 'timeout' || code === 'unavailable'
  }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable } }
}
export function safeFeatureFlagsError(error: unknown) {
  if (error instanceof FeatureFlagsError) return error
  let cause = error
  for (let i = 0; i < 4 && cause && typeof cause === 'object'; i++) {
    if ('code' in cause) break
    cause = 'cause' in cause ? cause.cause : undefined
  }
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
  return new FeatureFlagsError(code === '57014' || code === '55P03' ? 'timeout' : code === '23505' ? 'conflict' : 'unavailable')
}
