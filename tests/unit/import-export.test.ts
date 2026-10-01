import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseCsv, exportCsv, spreadsheetSafe, transferConfig, createTransferRegistry, trustedContext } from '../../packages/nuxt-import-export/src/runtime/server/index'
const config = transferConfig({})
const schema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).transform(value => value || null) })
const csv = (text: string, settings = config) => parseCsv(Buffer.from(text), ['name', 'description'], schema, settings)
describe('Import / Export shared CSV contract', () => {
  it('accepts BOM, Unicode, CRLF, escaped quotes and multiline with no parser conversion', () => {
    expect(csv('\ufeffname,description\r\n café ,"line 1\n""line 2"""\r\n')).toEqual([{ name: 'café', description: 'line 1\n"line 2"' }])
    expect(csv('name,description\n')).toEqual([])
  })
  it('rejects ambiguous headers and malformed UTF8 without parser values', () => {
    for (const source of ['', 'description,name\na,b', 'name,name\na,b', '__proto__,description\na,b', 'name,description\na,b,c', 'name,description\n\n', 'name,description\n"unclosed,b']) expect(() => csv(source)).toThrow()
    expect(() => parseCsv(Buffer.from([0xff]), ['name', 'description'], schema, config)).toThrow('CSV format is invalid.')
  })
  it('bounds rows, bytes, fields and normalized data with safe validation issues', () => {
    expect(() => csv('name,description\na,b\nc,d', { ...config, maxRows: 1 })).toThrow('Transfer exceeds a supported limit.')
    expect(() => csv('name,description\na,b', { ...config, maxBytes: 5 })).toThrow('Transfer exceeds a supported limit.')
    expect(() => csv(`name,description\na,"${'x'.repeat(65537)}"`)).toThrow('Transfer exceeds a supported limit.')
    try { csv(`name,description\n${'private-invalid-value'.repeat(10)},secret`) }
    catch (error) { expect(error).toMatchObject({ code: 'validation-failed', issues: [{ row: 1, field: 'name', code: 'invalid-value' }] }); expect(JSON.stringify(error)).not.toContain('private-invalid-value') }
    try { csv('name,description\n' + ',secret\n'.repeat(101)) }
    catch (error) { expect(error).toMatchObject({ code: 'validation-failed', errorsTruncated: true }); expect((error as { issues: unknown[] }).issues).toHaveLength(100) }
  })
  it('enforces column/header/UTF8 field/row and normalized JSON bounds', () => {
    const columns = Array.from({ length: 65 }, (_, index) => `field${index}`)
    expect(() => parseCsv(Buffer.from(columns.join(',')), columns, z.any(), config)).toThrow('Transfer input is invalid.')
    expect(() => csv(`${'x'.repeat(65)},description\na,b`)).toThrow('Transfer exceeds a supported limit.')
    expect(() => csv(`name,description\na,"${'😀'.repeat(16385)}"`)).toThrow('Transfer exceeds a supported limit.')
    const five = ['a', 'b', 'c', 'd', 'e']
    expect(() => parseCsv(Buffer.from(five.join(',') + '\n' + five.map(() => 'x'.repeat(60000)).join(',')), five, z.any(), config)).toThrow('Transfer exceeds a supported limit.')
    expect(() => csv('name,description\na,' + String.fromCharCode(0).repeat(1000), { ...config, maxBytes: 1024 })).toThrow('Transfer exceeds a supported limit.')
    expect(() => exportCsv([['a', 'b'], ['c', 'd']], ['name', 'description'], { ...config, maxRows: 1 })).toThrow('Transfer exceeds a supported limit.')
  })
  it('applies one formula mitigation with numeric negatives preserved', () => {
    for (const dangerous of ['=SUM(1)', '+1', '-1', '@name', '\tfoo', '\rfoo', '\nfoo', '  =1', '＝1', '＋1', '－1', '＠x', '  ＝1']) expect(spreadsheetSafe(dangerous)).toBe(`'${dangerous}`)
    for (const safe of ['ordinary', '  ordinary', "'=1", '1']) expect(spreadsheetSafe(safe)).toBe(safe)
    expect(exportCsv([['-1', -1], ['a,"b"', null]], ['name', 'description'], config).toString()).toBe('name,description\r\n\'-1,-1\r\n"a,""b""",\r\n')
    expect(exportCsv([['name', 'quoted\nline']], ['name', 'description'], config).toString()).toBe('name,description\r\nname,"quoted\nline"\r\n')
    expect(() => exportCsv([[{} as string, '']], ['name', 'description'], config)).toThrow('Transfer operation is unsupported.')
  })
  it('bounds the final formula-mitigated UTF8 field without changing numeric negatives', () => {
    for (const bytes of [65535, 65536]) {
      for (const prefix of ['=', '＝', '\t']) {
        const value = prefix + '😀'.repeat(Math.floor((bytes - Buffer.byteLength(prefix)) / 4)) + 'x'.repeat((bytes - Buffer.byteLength(prefix)) % 4)
        expect(Buffer.byteLength(value)).toBe(bytes)
        if (bytes === 65535) expect(exportCsv([[value]], ['value'], config).toString()).toBe(`value\r\n'${value}\r\n`)
        else expect(() => exportCsv([[value]], ['value'], config)).toThrow('Transfer exceeds a supported limit.')
      }
    }
    expect(exportCsv([[-65536]], ['value'], config).toString()).toBe('value\r\n-65536\r\n')
  })
  it('validates lazy configuration and exact trusted scope', () => {
    expect(transferConfig({ IMPORT_EXPORT_MAX_BYTES: '' }).maxBytes).toBe(16777216)
    for (const value of ['1e4', '1024x', ' 1024', '-1024', '1023', '67108865']) expect(() => transferConfig({ IMPORT_EXPORT_MAX_BYTES: value })).toThrow('Transfer configuration is invalid.')
    expect(() => trustedContext({ requesterId: 'opaque:user', scope: { kind: 'user', id: 'other' } })).toThrow('Transfer permission is denied.')
    expect(() => createTransferRegistry([]).get('unknown')).toThrow('Transfer input is invalid.')
  })
})
