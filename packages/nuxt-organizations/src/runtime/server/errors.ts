const messages = {
  configuration: 'Organizations configuration is invalid.',
  'invalid-input': 'Organizations input is invalid.', unauthenticated: 'Authentication is required.',
  forbidden: 'Organizations operation is forbidden.', 'not-found': 'Organization resource was not found.',
  conflict: 'Organizations state conflicts with this operation.', 'limit-exceeded': 'Organizations admission limit was reached.',
  expired: 'Invitation has expired.', unsupported: 'Organizations operation is unsupported.',
  timeout: 'Organizations operation timed out.', unavailable: 'Organizations dependency is unavailable.',
  unknown: 'Organizations operation failed.',
} as const
export type OrganizationErrorCode = keyof typeof messages
export class OrganizationError extends Error {
  readonly retryable: boolean
  constructor(readonly code: OrganizationErrorCode) {
    super(messages[code])
    this.name = 'OrganizationError'
    this.retryable = code === 'timeout' || code === 'unavailable'
  }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable } }
}
export function safeOrganizationError(error: unknown): OrganizationError {
  if (error instanceof OrganizationError) return error
  let cause = error
  for (let depth = 0; depth < 4 && cause && typeof cause === 'object'; depth++) {
    if ('code' in cause) break
    cause = 'cause' in cause ? cause.cause : undefined
  }
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
  if (code === '57014' || code === '55P03') return new OrganizationError('timeout')
  if (code === '23505') return new OrganizationError('conflict')
  return new OrganizationError('unavailable')
}
