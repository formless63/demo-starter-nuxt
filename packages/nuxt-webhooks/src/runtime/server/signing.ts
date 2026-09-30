import { createHmac, timingSafeEqual } from 'node:crypto'
import { boundedInteger, WebhookError } from './errors'
import { webhookIdSchema } from './events'

function decodeSecret(secret: string) {
  if (typeof secret !== 'string') throw new WebhookError('configuration')
  const base64 = secret.startsWith('whsec_') ? secret.slice(6) : secret
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new WebhookError('configuration')
  const key = Buffer.from(base64, 'base64')
  if (key.length < 24 || key.length > 64) throw new WebhookError('configuration')
  return key
}

function digest(id: string, timestamp: string, body: Uint8Array, secret: string) {
  return createHmac('sha256', decodeSecret(secret)).update(`${id}.${timestamp}.`).update(body).digest()
}

export function signWebhook(id: string, body: Uint8Array, secret: string, now = Date.now()) {
  if (!webhookIdSchema.safeParse(id).success || !Number.isSafeInteger(now) || now < 0) throw new WebhookError('configuration')
  const timestamp = String(Math.floor(now / 1000))
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${digest(id, timestamp, body, secret).toString('base64')}`,
  }
}

export function verifyWebhookSignature(body: Uint8Array, headers: Headers, secrets: readonly string[], options: { toleranceSeconds?: number, now?: number } = {}) {
  const id = headers.get('webhook-id') ?? ''
  const timestamp = headers.get('webhook-timestamp') ?? ''
  const signature = headers.get('webhook-signature') ?? ''
  const tolerance = boundedInteger(options.toleranceSeconds ?? 300, 1, 3600)
  const now = options.now ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0 || secrets.length < 1 || secrets.length > 8) throw new WebhookError('configuration')
  if (!webhookIdSchema.safeParse(id).success || !/^(0|[1-9][0-9]{0,12})$/.test(timestamp)
    || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > tolerance || signature.length > 4096) throw new WebhookError('invalid-signature')
  const candidates = signature.split(' ').filter(s => /^v1,[A-Za-z0-9+/]{43}=$/.test(s)).map(s => Buffer.from(s.slice(3), 'base64'))
  let valid = false
  for (const secret of secrets) {
    const expected = digest(id, timestamp, body, secret)
    for (const candidate of candidates) valid = timingSafeEqual(expected, candidate) || valid
  }
  if (!valid) throw new WebhookError('invalid-signature')
  return id
}
