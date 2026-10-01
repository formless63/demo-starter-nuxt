import { createError } from 'h3'
import { safeTransferError } from '@repo/nuxt-import-export/server'
import type { TransferErrorCode } from '@repo/nuxt-import-export/server'
const statuses: Record<TransferErrorCode, number> = { configuration: 503, 'invalid-input': 400, unauthenticated: 401, forbidden: 403, 'not-found': 404, conflict: 409, 'limit-exceeded': 413, 'invalid-format': 400, 'validation-failed': 400, expired: 409, cancelled: 409, timeout: 504, unavailable: 503, 'execution-lost': 503, unsupported: 422, unknown: 500 }
export async function transferHttp<T>(action: () => Promise<T>) {
  try { return await action() }
  catch (error) { const safe = safeTransferError(error); throw createError({ statusCode: statuses[safe.code], statusMessage: safe.message, data: safe.toJSON() }) }
}
