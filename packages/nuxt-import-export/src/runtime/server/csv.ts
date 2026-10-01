import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import type { ZodType } from 'zod'
import { TransferError } from './errors'
import type { ValidationIssue } from './errors'
import type { TransferConfig } from './config'
export function validateColumns(columns: readonly string[]) {
  if (!Array.isArray(columns) || !columns.length || columns.length > 64 || new Set(columns).size !== columns.length
    || columns.some(value => typeof value !== 'string' || !value || value.length > 64 || ['__proto__', 'prototype', 'constructor'].includes(value))) throw new TransferError('invalid-input')
}
/** One canonical mitigation; numeric values are intentionally not escaped. */
export function spreadsheetSafe(value: string) {
  return /^(?:[=+\-@\t\r\n＝＋－＠]|\s+[=+\-@＝＋－＠])/u.test(value) ? `'${value}` : value
}
// Bound logical fields/records before csv-parse allocates its cell buffers.
function guardCsv(text: string) {
  let quoted = false, fieldBytes = 0, fieldUnits = 0, rowBytes = 0, fields = 1, header = true
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index++) {
    const char = text[index]!
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { index++; fieldBytes++; fieldUnits++; rowBytes++ }
      else quoted = !quoted
    }
    else if (!quoted && char === ',') { fieldBytes = 0; fieldUnits = 0; if (++fields > 64) throw new TransferError('limit-exceeded') }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index++
      header = false; fieldBytes = 0; fieldUnits = 0; rowBytes = 0; fields = 1
    }
    else {
      const point = text.codePointAt(index)!
      const units = point > 0xffff ? 2 : 1, size = point > 0xffff ? 4 : point > 0x7ff ? 3 : point > 0x7f ? 2 : 1
      index += units - 1; fieldBytes += size; fieldUnits += units; rowBytes += size
    }
    if (fieldBytes > 65536 || rowBytes > 262144 || (header && fieldUnits > 64)) throw new TransferError('limit-exceeded')
  }
}
export function parseCsv<Row>(bytes: Uint8Array, columns: readonly string[], schema: ZodType<Row>, config: TransferConfig): Row[] {
  validateColumns(columns)
  if (bytes.byteLength > config.maxBytes) throw new TransferError('limit-exceeded')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new TransferError('invalid-format') }
  guardCsv(text)
  const rows: Row[] = [], issues: ValidationIssue[] = []
  let ordinal = 0, normalizedBytes = 0, errorsTruncated = false, header = false
  try {
    parse(text, {
      bom: true, columns: false, cast: false, trim: false, delimiter: ',', quote: '"', escape: '"',
      record_delimiter: ['\r\n', '\n'], max_record_size: 262144, skip_empty_lines: false,
      on_record(record: string[]) {
        if (record.length > 64 || record.some(field => Buffer.byteLength(field) > 65536)
          || record.reduce((size, field) => size + Buffer.byteLength(field), 0) > 262144) throw new TransferError('limit-exceeded')
        if (!header) {
          if (record.length !== columns.length || record.some((field, index) => field !== columns[index])) throw new TransferError('invalid-format')
          header = true
          return null
        }
        ordinal++
        if (ordinal > config.maxRows) throw new TransferError('limit-exceeded')
        if (record.length !== columns.length || (record.length === 1 && record[0] === '')) throw new TransferError('invalid-format')
        const input = Object.create(null) as Record<string, string>
        columns.forEach((field, index) => { input[field] = record[index]! })
        normalizedBytes += Buffer.byteLength(JSON.stringify(input))
        if (normalizedBytes > config.maxBytes * 2) throw new TransferError('limit-exceeded')
        const result = schema.safeParse(input)
        if (result.success) rows.push(result.data)
        else for (const issue of result.error.issues) {
          if (issues.length >= 100) { errorsTruncated = true; continue }
          const field = typeof issue.path[0] === 'string' && columns.includes(issue.path[0]) ? issue.path[0] : undefined
          issues.push({ row: ordinal, ...(field ? { field } : {}), code: 'invalid-value' })
        }
        return null
      },
    })
  }
  catch (error) {
    if (error instanceof TransferError) throw error
    if ((error as { code?: string })?.code === 'CSV_MAX_RECORD_SIZE') throw new TransferError('limit-exceeded')
    throw new TransferError('invalid-format')
  }
  if (!header) throw new TransferError('invalid-format')
  if (issues.length) throw new TransferError('validation-failed', issues, errorsTruncated)
  return rows
}
export type CsvCell = string | number | boolean | null | undefined
export function exportCsv(rows: Iterable<readonly CsvCell[]>, columns: readonly string[], config: TransferConfig): Buffer {
  validateColumns(columns)
  const chunks: Buffer[] = []
  let bytes = 0, count = 0
  function append(row: readonly CsvCell[]) {
    if (row.length !== columns.length) throw new TransferError('unsupported')
    const cells = row.map((cell) => {
      if (cell === null || cell === undefined) return ''
      if (typeof cell === 'string') {
        if (Buffer.byteLength(cell) > 65536) throw new TransferError('limit-exceeded')
        return spreadsheetSafe(cell)
      }
      if (typeof cell === 'boolean') return String(cell)
      if (typeof cell === 'number' && Number.isFinite(cell)) return String(cell)
      throw new TransferError('unsupported')
    })
    if (cells.reduce((size, cell) => size + Buffer.byteLength(cell), 0) > 262144) throw new TransferError('limit-exceeded')
    const chunk = Buffer.from(stringify([cells], { record_delimiter: '\r\n', quoted_match: /[\r\n]/, eof: true }))
    bytes += chunk.byteLength
    if (bytes > config.maxBytes) throw new TransferError('limit-exceeded')
    chunks.push(chunk)
  }
  // Registered headers are authoritative and are never formula transformed.
  const header = Buffer.from(stringify([columns], { record_delimiter: '\r\n', quoted_match: /[\r\n]/, eof: true }))
  bytes = header.byteLength; chunks.push(header)
  for (const row of rows) { if (++count > config.maxRows) throw new TransferError('limit-exceeded'); append(row) }
  if (bytes > config.maxBytes) throw new TransferError('limit-exceeded')
  return Buffer.concat(chunks, bytes)
}
