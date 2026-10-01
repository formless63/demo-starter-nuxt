import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { auditAction, auditLimits, validateMetadata } from '../../packages/nuxt-audit-log/src/runtime/server/validation'
import { auditEvent } from '../../packages/nuxt-audit-log/src/runtime/server/schema'

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
  it('indexes action before descending pagination columns without a metadata index', () => {
    const indexes = getTableConfig(auditEvent).indexes
    const action = indexes.find(index => index.config.name === 'audit_event_action_created_id_idx')!
    expect(action.config.columns.map(column => 'name' in column ? column.name : undefined)).toEqual(['action', 'created_at', 'id'])
    expect(indexes.some(index => index.config.method === 'gin')).toBe(false)
  })
})
