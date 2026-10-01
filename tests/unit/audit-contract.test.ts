import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { auditAction, auditLimits, validateMetadata } from '../../packages/nuxt-audit-log/src/runtime/server/validation'
import { auditEvent } from '../../packages/nuxt-audit-log/src/runtime/server/schema'
import { appendAuditEvent } from '../../packages/nuxt-audit-log/src/runtime/server/events'

describe('Audit contract', () => {
  it('accepts lowercase namespaced identifiers and rejects prose or malformed actions', () => {
    for (const action of ['projects.create', 'projects.update', 'projects.delete', 'billing.invoice_paid']) expect(auditAction(action)).toBe(action)
    for (const action of ['created project', 'Projects.create', 'create', 'projects..create', '.create', 'projects.create!', 'projects.create\n']) expect(() => auditAction(action)).toThrow('Invalid audit data')
  })
  it('bounds encoded JSON to 8 KiB, including multibyte strings and JSON overhead', () => {
    expect(auditLimits.metadataBytes).toBe(8192)
    const metadata = { values: Array(8).fill('x'.repeat(1000)) }
    expect(validateMetadata(metadata)).toEqual(metadata)
    expect(() => validateMetadata({ values: Array(9).fill('x'.repeat(1000)) })).toThrow()
    expect(() => validateMetadata({ values: Array(3).fill('界'.repeat(1000)) })).toThrow()
  })
  it('accepts exact metadata key/string bounds and rejects secret containers, malformed strings and custom arrays', () => {
    expect(validateMetadata({ ['x'.repeat(64)]: 'x'.repeat(1024) })).toEqual({ ['x'.repeat(64)]: 'x'.repeat(1024) })
    const hiddenArray = Object.defineProperty([1], '0', { value: 1, enumerable: false })
    const hiddenObject = Object.defineProperty({}, 'hidden', { value: 1 })
    for (const key of ['credential', 'CREDENTIAL_ID', 'client.credential', 'cre-den-tial', 'request', 'r_e_q_u_e_s_t', 'session', 'body', 'header', 'headers', '__proto__', 'constructor', 'prototype']) {
      expect(() => validateMetadata({ nested: [{ [key]: 'private' }] })).toThrow('Invalid audit data')
    }
    for (const metadata of [{ ['x'.repeat(65)]: 'safe' }, { value: 'x'.repeat(1025) }, { value: '\ud800' }, { value: '\u0001' }, { value: '\n' }, { value: '\u0085' }, hiddenObject, { value: hiddenArray }, { value: Object.assign([1], { custom: 2 }) }]) {
      expect(() => validateMetadata(metadata)).toThrow('Invalid audit data')
    }
  })
  it('enforces every public field bound before insertion', async () => {
    const values = (input: unknown) => ({ returning: async () => [input] })
    const writer = { insert: () => ({ values }) } as unknown as Parameters<typeof appendAuditEvent>[0]
    const base = { actorType: 'user', action: 'record.created', subjectType: 'record' }
    for (const [key, max] of Object.entries({ actorType: 32, actorId: 128, action: 128, subjectType: 64, subjectId: 128, outcome: 32, requestId: 128 })) {
      const value = key === 'action' ? `a.${'b'.repeat(max - 2)}` : 'x'.repeat(max)
      await expect(appendAuditEvent(writer, { ...base, [key]: value })).resolves.toMatchObject({ [key]: value })
      await expect(appendAuditEvent(writer, { ...base, [key]: `${value}x` })).rejects.toThrow('Invalid audit data')
    }
  })
  it('indexes action before descending pagination columns without a metadata index', () => {
    const indexes = getTableConfig(auditEvent).indexes
    const action = indexes.find(index => index.config.name === 'audit_event_action_created_id_idx')!
    expect(action.config.columns.map(column => 'name' in column ? column.name : undefined)).toEqual(['action', 'created_at', 'id'])
    expect(indexes.some(index => index.config.method === 'gin')).toBe(false)
  })
})
