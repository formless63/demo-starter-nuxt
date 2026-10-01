import { Buffer } from 'node:buffer'
import { and, desc, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'

export const searchDefaults = Object.freeze({ configuration: 'simple', minQueryLength: 2, maxQueryLength: 256, pageSize: 25, maxPageSize: 100, maxCursorLength: 2048, maxIdLength: 128 })
export type SearchErrorCode = 'invalid-query' | 'unavailable'
export class SearchError extends Error {
  constructor(public readonly code: SearchErrorCode) {
    super(code === 'invalid-query' ? 'Invalid search request' : 'Search unavailable')
    this.name = 'SearchError'
  }
}
export interface SearchInput { query: string, pageSize?: number, cursor?: string }
export type SearchCursor = [1, number, string, string]
export interface SearchColumns { vector: AnyColumn, updatedAt: AnyColumn, id: AnyColumn }
export interface SearchPlan { where: SQL, orderBy: SQL[], rank: SQL<number>, cursorUpdatedAt: SQL<string>, limit: number }
export interface SearchRow { id: string, rank: number, cursorUpdatedAt: string }
export interface SearchPage<T> { items: T[], nextCursor: string | null }

function invalid(): never { throw new SearchError('invalid-query') }
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/.exec(value)
  if (!parts) return false
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number) as [number, number, number, number, number, number]
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! && hour <= 23 && minute <= 59 && second <= 59
}
function validateCursor(value: unknown): SearchCursor {
  if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1) return invalid()
  const [, rank, date, id] = value
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 0 || rank > 1 || Math.fround(rank) !== rank || Object.is(rank, -0)) return invalid()
  // Validate the calendar without converting away PostgreSQL's microseconds.
  if (!validTimestamp(date)) return invalid()
  if (typeof id !== 'string' || id.length === 0 || id.length > searchDefaults.maxIdLength || !id.isWellFormed() || /\p{Cc}/u.test(id)) return invalid()
  return value as SearchCursor
}
export function encodeSearchCursor(value: SearchCursor): string {
  const encoded = Buffer.from(JSON.stringify(validateCursor(value))).toString('base64url')
  if (encoded.length > searchDefaults.maxCursorLength) return invalid()
  return encoded
}
export function decodeSearchCursor(value: string): SearchCursor {
  if (typeof value !== 'string' || value.length === 0 || value.length > searchDefaults.maxCursorLength || !/^[A-Za-z0-9_-]+$/.test(value)) return invalid()
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64url'))
    const cursor = validateCursor(JSON.parse(json))
    if (encodeSearchCursor(cursor) !== value) return invalid()
    return cursor
  }
  catch { return invalid() }
}

/** Caller supplies the authorization predicate and selects application-owned domain fields. */
export async function searchRows<T extends SearchRow>(
  columns: SearchColumns,
  scope: SQL,
  input: SearchInput,
  fetchRows: (plan: SearchPlan) => Promise<T[]>,
): Promise<SearchPage<Omit<T, 'cursorUpdatedAt'>>> {
  if (!input || typeof input.query !== 'string') return invalid()
  const query = input.query.trim()
  if (query.length < searchDefaults.minQueryLength || query.length > searchDefaults.maxQueryLength || query.includes('\0') || !query.isWellFormed()) return invalid()
  const pageSize = input.pageSize === undefined ? searchDefaults.pageSize : input.pageSize
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > searchDefaults.maxPageSize) return invalid()
  const cursor = input.cursor === undefined ? undefined : decodeSearchCursor(input.cursor)
  const tsquery = sql`websearch_to_tsquery('simple', ${query})`
  const rankExpression = sql`ts_rank_cd(${columns.vector}, ${tsquery}, 32)`
  const rank = sql<number>`${rankExpression}::double precision`.mapWith(Number)
  const cursorUpdatedAt = sql<string>`to_char(${columns.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
  const after = cursor
    ? sql`(${rankExpression}, ${columns.updatedAt}, ${columns.id}) < (${cursor[1]}::real, ${cursor[2]}::timestamptz, ${cursor[3]}::text)`
    : undefined
  try {
    const rows = await fetchRows({
      where: and(scope, sql`${columns.vector} @@ ${tsquery}`, after)!,
      orderBy: [desc(rankExpression), desc(columns.updatedAt), desc(columns.id)],
      rank, cursorUpdatedAt, limit: pageSize + 1,
    })
    const page = rows.slice(0, pageSize)
    const last = page.at(-1)
    const nextCursor = rows.length > pageSize && last
      ? encodeSearchCursor([1, last.rank, last.cursorUpdatedAt, last.id])
      : null
    return { items: page.map(({ cursorUpdatedAt: _cursorUpdatedAt, ...row }) => row), nextCursor }
  }
  catch {
    // Never attach SQL/parameters/cause or emit raw text through telemetry.
    throw new SearchError('unavailable')
  }
}
