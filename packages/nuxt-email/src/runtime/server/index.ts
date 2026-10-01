import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { inspect } from 'node:util'

export type EmailErrorCode = 'configuration' | 'connection' | 'timeout' | 'tls' | 'authentication' | 'temporary-rejection' | 'permanent-rejection' | 'message' | 'unknown'
export class EmailError extends Error {
  constructor(public readonly code: EmailErrorCode, public readonly retryable = false, cause?: unknown) {
    super(`Email operation failed (${code})`, { cause })
    this.name = 'EmailError'
  }

  toJSON() { return { name: this.name, code: this.code, retryable: this.retryable, message: this.message } }
  [inspect.custom]() { return this.toJSON() }
}

export type EmailSecurity = 'tls' | 'starttls' | 'opportunistic'
export interface EmailAddress { address: string, name?: string }
export interface EmailConfig {
  host: string
  port: number
  security: EmailSecurity
  user?: string
  password?: string
  from: EmailAddress
  replyTo?: EmailAddress
  maxRecipients: number
}
export interface EmailMessage {
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  replyTo?: EmailAddress
  subject: string
  text?: string
  html?: string
}
export interface EmailSendResult {
  outcome: 'accepted' | 'rejected' | 'partial'
  messageId: string
  accepted: number
  rejected: number
}
export const EMAIL_LIMITS = { address: 254, displayName: 128, subject: 200, bodyBytes: 1024 * 1024, maxRecipients: 100 } as const
// eslint-disable-next-line no-control-regex -- reject header injection explicitly
const control = /[\u0000-\u001f\u007f]/u
function fail(code: 'configuration' | 'message'): never { throw new EmailError(code) }
function label(value: unknown, code: 'configuration' | 'message', max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || control.test(value)) fail(code)
  return value
}
function address(value: unknown, code: 'configuration' | 'message'): EmailAddress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(key => !['address', 'name'].includes(key))) fail(code)
  const mailbox = label(v.address, code, EMAIL_LIMITS.address)
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/u.test(mailbox)) fail(code)
  return { address: mailbox, ...(v.name === undefined ? {} : { name: label(v.name, code, EMAIL_LIMITS.displayName) }) }
}

// Explicit server overrides are useful to standalone consumers; no runtimeConfig/public copy.
export function resolveEmailConfig(env: Record<string, string | undefined> = process.env): EmailConfig {
  return validateEmailConfig({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT), security: env.SMTP_SECURITY,
    user: env.SMTP_USER || undefined, password: env.SMTP_PASSWORD || undefined,
    from: { address: env.EMAIL_FROM_ADDRESS, ...(env.EMAIL_FROM_NAME ? { name: env.EMAIL_FROM_NAME } : {}) },
    replyTo: env.EMAIL_REPLY_TO_ADDRESS ? { address: env.EMAIL_REPLY_TO_ADDRESS, ...(env.EMAIL_REPLY_TO_NAME ? { name: env.EMAIL_REPLY_TO_NAME } : {}) } : undefined,
    maxRecipients: Number(env.EMAIL_MAX_RECIPIENTS ?? 50),
    ...(env.EMAIL_REPLY_TO_NAME && !env.EMAIL_REPLY_TO_ADDRESS ? { invalid: true } : {}),
  })
}
export function validateEmailConfig(value: unknown): EmailConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('configuration')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(key => !['host', 'port', 'security', 'user', 'password', 'from', 'replyTo', 'maxRecipients'].includes(key))) fail('configuration')
  const host = label(v.host, 'configuration', 253)
  if (!/^[a-zA-Z0-9.:-]+$/u.test(host)) fail('configuration')
  if (!Number.isInteger(v.port) || Number(v.port) < 1 || Number(v.port) > 65535) fail('configuration')
  if (!['tls', 'starttls', 'opportunistic'].includes(String(v.security))) fail('configuration')
  if ((v.user === undefined) !== (v.password === undefined)) fail('configuration')
  if (v.user !== undefined) { label(v.user, 'configuration', 320); label(v.password, 'configuration', 2048) }
  const maxRecipients = v.maxRecipients ?? 50
  if (!Number.isInteger(maxRecipients) || Number(maxRecipients) < 1 || Number(maxRecipients) > EMAIL_LIMITS.maxRecipients) fail('configuration')
  return { host, port: Number(v.port), security: v.security as EmailSecurity, user: v.user as string | undefined, password: v.password as string | undefined,
    from: address(v.from, 'configuration'), replyTo: v.replyTo === undefined ? undefined : address(v.replyTo, 'configuration'), maxRecipients: Number(maxRecipients) }
}
export function emailTransportOptions(config: EmailConfig): SMTPTransport.Options {
  const c = validateEmailConfig(config)
  return { host: c.host, port: c.port, secure: c.security === 'tls', requireTLS: c.security === 'starttls',
    auth: c.user === undefined ? undefined : { user: c.user, pass: c.password },
    connectionTimeout: 5000, greetingTimeout: 5000, dnsTimeout: 5000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true, maxRecipients: c.maxRecipients,
    logger: false, debug: false,
  }
}
export function validateEmailMessage(value: unknown, maxRecipients = 50): EmailMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('message')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(key => !['to', 'cc', 'bcc', 'replyTo', 'subject', 'text', 'html'].includes(key))) fail('message')
  const recipients = (key: string, required = false): EmailAddress[] => {
    const list = v[key]
    if (list === undefined && !required) return []
    if (!Array.isArray(list) || (required && list.length === 0) || list.length > maxRecipients) fail('message')
    return list.map(item => address(item, 'message'))
  }
  const to = recipients('to', true), cc = recipients('cc'), bcc = recipients('bcc')
  if (to.length + cc.length + bcc.length > maxRecipients) fail('message')
  const subject = label(v.subject, 'message', EMAIL_LIMITS.subject)
  let bytes = 0
  for (const key of ['text', 'html']) {
    const body = v[key]
    if (body !== undefined) {
      // eslint-disable-next-line no-control-regex -- allow body newlines, reject other controls
      if (typeof body !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)) fail('message')
      bytes += Buffer.byteLength(body)
    }
  }
  if ((!v.text && !v.html) || bytes > EMAIL_LIMITS.bodyBytes) fail('message')
  return { to, cc, bcc, subject, text: v.text as string | undefined, html: v.html as string | undefined,
    replyTo: v.replyTo === undefined ? undefined : address(v.replyTo, 'message') }
}
export function classifyEmailError(error: unknown): EmailError {
  if (error instanceof EmailError) return error
  const e = (error && typeof error === 'object' ? error : {}) as { code?: string, responseCode?: number, command?: string, syscall?: string }
  // Provider text/response, address lists and nested causes are never serialized.
  if (e.code === 'EAUTH' || e.responseCode === 535) return new EmailError('authentication', false, error)
  if (e.code === 'ETIMEDOUT') return new EmailError('timeout', false, error)
  if (e.code === 'ETLS' || e.code?.includes('CERT') || e.code?.includes('TLS')) return new EmailError('tls', false, error)
  if (e.responseCode && e.responseCode >= 400 && e.responseCode < 500) return new EmailError('temporary-rejection', true, error)
  if (e.responseCode && e.responseCode >= 500 && e.responseCode < 600) return new EmailError('permanent-rejection', false, error)
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.code ?? '')) return new EmailError('connection', true, error)
  if (e.code === 'ESOCKET' && e.command === 'CONN' && e.syscall === 'connect') return new EmailError('connection', true, error)
  if (e.code === 'ECONNECTION') return new EmailError('connection', false, error)
  if (e.code === 'EMESSAGE' || e.code === 'EMAXRECIPIENTS') return new EmailError('message', false, error)
  // Connection reset/socket errors can follow acceptance: do not imply safe retry.
  return new EmailError('unknown', false, error)
}
export function createEmail(config?: EmailConfig) {
  const resolved = config === undefined ? resolveEmailConfig() : validateEmailConfig(config)
  const transport = nodemailer.createTransport(emailTransportOptions(resolved), { maxRecipients: resolved.maxRecipients })
  return {
    security: resolved.security,
    async verify() {
      try { await transport.verify(); return { ok: true as const } }
      catch (error) { throw classifyEmailError(error) }
    },
    async send(value: EmailMessage): Promise<EmailSendResult> {
      const message = validateEmailMessage(value, resolved.maxRecipients)
      try {
        const result = await transport.sendMail({ ...message, from: resolved.from, replyTo: message.replyTo ?? resolved.replyTo })
        const accepted = result.accepted.length, rejected = result.rejected.length
        return { outcome: accepted && rejected ? 'partial' : accepted ? 'accepted' : 'rejected', messageId: result.messageId, accepted, rejected }
      }
      catch (error) { throw classifyEmailError(error) }
    },
    close() { transport.close() },
  }
}
let singleton: ReturnType<typeof createEmail> | undefined
export function getEmail() { return singleton ??= createEmail() }
export function closeEmail() { singleton?.close(); singleton = undefined }
export function verifyEmailTransport() { return getEmail().verify() }
export function sendEmail(message: EmailMessage) { return getEmail().send(message) }

export function renderMagicLinkEmail(url: string, canonicalBaseUrl: string) {
  let parsed: URL, canonical: URL
  try { parsed = new URL(url); canonical = new URL(canonicalBaseUrl) }
  catch { throw new EmailError('message') }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== canonical.origin || parsed.username || parsed.password || control.test(url)) fail('message')
  const escaped = parsed.href.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
  return { subject: 'Sign in to your account', text: `Use this link to sign in:\n\n${parsed.href}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Use this link to sign in:</p><p><a href="${escaped}">Sign in</a></p><p>If you did not request this, ignore this email.</p>` }
}
