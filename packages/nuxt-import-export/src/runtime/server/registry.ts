import type { ZodType } from 'zod'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { validateColumns } from './csv'
import type { CsvCell } from './csv'
import { TransferError } from './errors'
import type { TransferContext } from './config'
export type TransferTransaction = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'insert' | 'update' | 'delete' | 'execute'>
export interface TransferDefinition<Row = unknown> {
  name: string
  version: string
  columns: readonly string[]
  rowSchema: ZodType<Row>
  authorize(context: TransferContext, tx?: TransferTransaction): Promise<boolean>
  importRows(tx: TransferTransaction, context: TransferContext, rows: Row[], signal: AbortSignal): Promise<void>
  exportRows(tx: TransferTransaction, context: TransferContext, signal: AbortSignal): AsyncIterable<readonly CsvCell[]>
}
export function defineTransfer<Row>(definition: TransferDefinition<Row>) { return definition }
export function createTransferRegistry(definitions: TransferDefinition[]) {
  if (definitions.length > 64) throw new TransferError('invalid-input')
  const registry = new Map<string, TransferDefinition>()
  for (const definition of definitions) {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(definition.name) || definition.name.length > 64
      || !definition.version || definition.version.length > 64 || registry.has(definition.name)) throw new TransferError('invalid-input')
    validateColumns(definition.columns)
    registry.set(definition.name, Object.freeze({ ...definition, columns: Object.freeze([...definition.columns]) }))
  }
  return {
    get(name: string) { const result = registry.get(name); if (!result) throw new TransferError('invalid-input'); return result },
  }
}
export type TransferRegistry = ReturnType<typeof createTransferRegistry>
