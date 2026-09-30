import { describe, expect, it } from 'vitest'
import { safeError, sanitize } from '../../packages/nuxt-observability/src/runtime/server/safety'

describe('observability safety boundary', () => {
  it('omits secrets, raw request/session/job data and application extensions recursively', () => {
    const value = sanitize({ Authorization: 'secret', cookie: 'secret', 'set-cookie': 'secret',
      headers: { custom: 'secret' }, body: 'secret', query: 'secret', user: 'secret', session: 'secret',
      payload: 'secret', nested: { 'x-api-key': 'secret', password: 'secret', secret: 'secret', token: 'secret',
        accessToken: 'secret', refreshToken: 'secret', clientSecret: 'secret', privateNote: 'secret' },
      values: [{ databaseUrl: 'secret' }], safe: 'postgres://user:secret@host/db',
    }, ['privateNote'])
    expect(JSON.stringify(value)).not.toContain('secret')
    expect(value).toMatchObject({ nested: {}, values: [{}], safe: '[REDACTED_URL]' })
  })

  it('does not serialize arbitrary error text, stack, cause or custom properties', () => {
    const error = new TypeError('password=secret', { cause: new Error('secret') })
    expect(safeError(error)).toEqual({ type: 'TypeError', message: 'An operation failed' })
    expect(JSON.stringify(sanitize({ err: error }))).not.toContain('secret')
    expect(sanitize({ err: { type: 'TypeError', message: 'secret' } })).toEqual({ err: { type: 'TypeError', message: 'An operation failed' } })
  })

  it('bounds cyclic objects and leaves input unchanged', () => {
    const original = { safe: true, password: 'secret' }
    sanitize(original)
    expect(original.password).toBe('secret')
    const cyclic: Record<string, unknown> = {}
    cyclic.next = cyclic
    expect(() => JSON.stringify(sanitize(cyclic))).not.toThrow()
  })
})
