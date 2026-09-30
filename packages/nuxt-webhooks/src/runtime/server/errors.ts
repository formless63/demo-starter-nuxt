export type WebhookErrorCode = 'configuration' | 'body-too-large' | 'invalid-event' | 'invalid-signature' | 'invalid-target' | 'network' | 'timeout' | 'remote-status' | 'target-resolution'

/** Fixed messages only: no underlying cause, URL, headers, body or credentials. */
export class WebhookError extends Error {
  constructor(public readonly code: WebhookErrorCode, public readonly retryable = false, public readonly status?: number) {
    super(`Webhook ${code}`)
    this.name = 'WebhookError'
  }
}

export function boundedInteger(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new WebhookError('configuration')
  return value
}
