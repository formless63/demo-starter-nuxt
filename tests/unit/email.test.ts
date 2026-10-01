import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspect } from 'node:util'
import { classifyEmailError, closeEmail, createEmail, EMAIL_LIMITS, EmailError, emailTransportOptions, getEmail, renderMagicLinkEmail, resolveEmailConfig, validateEmailConfig, validateEmailMessage } from '@repo/nuxt-email/server'
import { mailpitEnv } from '../../fixtures/email-consumer/.fixture/mailpit'

const config = resolveEmailConfig(mailpitEnv(1025))
const message = { to: [{ address: 'user@example.test', name: 'User' }], subject: 'Hello', text: 'Hi' }
afterEach(() => { closeEmail(); vi.unstubAllEnvs() })
describe('Email configuration and content boundaries', () => {
  it('requires structural config only on use and rejects partial credentials/security bypasses', () => {
    expect(() => resolveEmailConfig({})).toThrow(EmailError)
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'EMAIL_FROM_ADDRESS']) {
      expect(() => resolveEmailConfig({ ...mailpitEnv(1025), [key]: '' })).toThrow(EmailError)
    }
    expect(() => validateEmailConfig({ ...config, password: undefined })).toThrow(EmailError)
    expect(() => validateEmailConfig({ ...config, user: undefined })).toThrow(EmailError)
    expect(() => validateEmailConfig({ ...config, tls: { rejectUnauthorized: false } })).toThrow(EmailError)
    expect(() => resolveEmailConfig({ ...mailpitEnv(1025), EMAIL_MAX_RECIPIENTS: '101' })).toThrow(EmailError)
    vi.stubEnv('SMTP_HOST', '')
    expect(() => getEmail()).toThrow(EmailError)
    expect(() => createEmail({ ...config, user: undefined, password: undefined })).not.toThrow()
  })
  it.each([['tls', true, false], ['starttls', false, true], ['opportunistic', false, false]] as const)('maps %s independently of port and disables content sources', (security, secure, requireTLS) => {
    expect(emailTransportOptions({ ...config, security, port: 465 })).toMatchObject({ secure, requireTLS, disableFileAccess: true, disableUrlAccess: true, maxRecipients: 50, debug: false, logger: false,
      connectionTimeout: 5000, greetingTimeout: 5000, dnsTimeout: 5000, socketTimeout: 10000 })
    expect(emailTransportOptions(config)).not.toHaveProperty('pool')
    expect(emailTransportOptions({ ...config, security })).not.toHaveProperty('tls.rejectUnauthorized')
  })
  it('bounds every address/subject/body and rejects controls/extra sources', () => {
    expect(validateEmailMessage(message)).toMatchObject(message)
    for (const bad of [{ ...message, to: ['user@example.test'] }, { ...message, to: [{ address: 'user@example.test\r\nBcc:evil@example.test' }] },
      { ...message, replyTo: { address: 'reply@example.test', name: '\u0000' } }, { ...message, subject: 'Hello\nInjected' },
      { ...message, subject: 'x'.repeat(201) }, { ...message, to: [{ address: 'user@example.test', name: 'x'.repeat(129) }] }, { ...message, text: 'é'.repeat(EMAIL_LIMITS.bodyBytes) },
      { ...message, text: undefined }, { ...message, html: { href: 'https://invalid.test' } }, { ...message, text: { path: '/etc/passwd' } },
      { ...message, raw: 'raw' }, { ...message, attachments: [] }, { ...message, headers: {} }, { ...message, envelope: {} },
      { ...message, cc: Array.from({ length: 50 }, () => ({ address: 'cc@example.test' })) }]) expect(() => validateEmailMessage(bad)).toThrow(EmailError)
  })
  it('accepts boundary subject/name/address sizes and bounds the combined UTF-8 body', () => {
    const address = `${'a'.repeat(241)}@example.test`
    expect(address.length).toBe(254)
    expect(validateEmailMessage({ ...message, subject: 'x'.repeat(200), to: [{ address, name: 'x'.repeat(128) }] }).subject).toHaveLength(200)
    expect(() => validateEmailMessage({ ...message, to: [{ address: `a${address}` }] })).toThrow(EmailError)
    const text = 'é'.repeat(EMAIL_LIMITS.bodyBytes / 4)
    expect(validateEmailMessage({ ...message, text, html: text })).toMatchObject({ text, html: text })
    expect(() => validateEmailMessage({ ...message, text, html: `${text}x` })).toThrow(EmailError)
  })
  it('escapes same-origin magic links and rejects foreign/unsafe URLs', () => {
    const rendered = renderMagicLinkEmail('https://app.example.test/api/auth/magic-link/verify?token=SECRET&callbackURL=%2Fapp', 'https://app.example.test')
    expect(rendered.html).toContain('&amp;'); expect(rendered.text).toContain('token=SECRET')
    for (const url of ['https://foreign.example.test/', 'javascript:alert(1)', 'https://user:pass@app.example.test/', 'bad']) {
      expect(() => renderMagicLinkEmail(url, 'https://app.example.test')).toThrow(EmailError)
    }
  })
  it('serializes only safe classifications and treats ambiguous acceptance conservatively', () => {
    for (const [raw, code, retryable] of [[{ responseCode: 451 }, 'temporary-rejection', true], [{ responseCode: 550 }, 'permanent-rejection', false],
      [{ code: 'EAUTH' }, 'authentication', false], [{ code: 'ETLS' }, 'tls', false], [{ code: 'ECONNREFUSED' }, 'connection', true],
      [{ code: 'ECONNECTION' }, 'connection', false], [{ code: 'EMESSAGE' }, 'message', false], [{ code: 'ETIMEDOUT' }, 'timeout', false], [{ code: 'ESOCKET' }, 'unknown', false]] as const) {
      const cause = { ...raw, message: 'SMTP_PASSWORD_SECRET recipient@example.test', response: 'RAW_SECRET' }
      const error = classifyEmailError(cause)
      expect(error).toMatchObject({ code, retryable, cause })
      expect(JSON.stringify(error)).not.toContain('SECRET'); expect(inspect(error)).not.toContain('recipient@example.test')
    }
  })
})
