import { inspect } from 'node:util'

export type AiErrorCode = 'configuration' | 'authentication' | 'rate-limit' | 'timeout' | 'unavailable' | 'invalid-request' | 'invalid-output' | 'cancelled' | 'unknown'
const messages: Record<AiErrorCode, string> = {
  'configuration': 'AI configuration is invalid.',
  'authentication': 'AI provider authentication failed.',
  'rate-limit': 'AI provider rate limit reached.',
  'timeout': 'AI operation timed out.',
  'unavailable': 'AI provider is unavailable.',
  'invalid-request': 'AI request is invalid.',
  'invalid-output': 'AI output is invalid.',
  'cancelled': 'AI operation was cancelled.',
  'unknown': 'AI operation failed.',
}
export class AiError extends Error {
  readonly retryable: boolean
  constructor(public readonly code: AiErrorCode) {
    super(messages[code])
    this.name = 'AiError'
    this.retryable = ['rate-limit', 'timeout', 'unavailable'].includes(code)
  }

  // No raw cause, response, request, headers or validation issues are retained.
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable } }
  [inspect.custom]() { return this.toJSON() }
}
export function safeAiError(error: unknown): AiError {
  if (error instanceof AiError) return error
  const e = (error && typeof error === 'object' ? error : {}) as { status?: number, name?: string }
  if (e.status === 401 || e.status === 403) return new AiError('authentication')
  if (e.status === 429) return new AiError('rate-limit')
  if (e.status === 408 || e.name === 'APIConnectionTimeoutError') return new AiError('timeout')
  if ((e.status && e.status >= 500) || e.name === 'APIConnectionError') return new AiError('unavailable')
  if (e.status && e.status >= 400 && e.status < 500) return new AiError('invalid-request')
  return new AiError('unknown')
}
