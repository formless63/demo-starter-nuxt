const messages = {
  configuration: 'Transfer configuration is invalid.', 'invalid-input': 'Transfer input is invalid.',
  unauthenticated: 'Authentication is required.', forbidden: 'Transfer permission is denied.',
  'not-found': 'Transfer was not found.', conflict: 'Transfer state or request conflicts.',
  'limit-exceeded': 'Transfer exceeds a supported limit.', 'invalid-format': 'CSV format is invalid.',
  'validation-failed': 'CSV rows failed validation.', expired: 'Transfer artifact has expired.',
  cancelled: 'Transfer was cancelled.', timeout: 'Transfer deadline exceeded.', unavailable: 'Transfer dependency is unavailable.',
  unsupported: 'Transfer operation is unsupported.', 'execution-lost': 'Transfer execution is no longer available.', unknown: 'Transfer could not be completed.',
} as const
export type TransferErrorCode = keyof typeof messages
export interface ValidationIssue { row: number, field?: string, code: 'invalid-value' }
export class TransferError extends Error {
  readonly retryable: boolean
  constructor(readonly code: TransferErrorCode, readonly issues: ValidationIssue[] = [], readonly errorsTruncated = false) {
    super(messages[code]); this.name = 'TransferError'; this.retryable = code === 'timeout' || code === 'unavailable'
  }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable } }
}
export function safeTransferError(error: unknown): TransferError {
  if (error instanceof TransferError) return error
  const code = (error as { code?: string })?.code
  if (code === 'cancelled') return new TransferError('cancelled')
  if (code === 'configuration') return new TransferError('configuration')
  if (code === 'unavailable' || ['40P01', '40001', '08006', '08003', '57P01', '53300', '55P03'].includes(code ?? '')) return new TransferError('unavailable')
  if (code === '57014' || code === '25P04') return new TransferError('timeout')
  return new TransferError('unknown')
}
