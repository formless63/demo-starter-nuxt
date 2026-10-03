import { describe, expect, it } from 'vitest'
import { AuthorizationError } from '@repo/nuxt-authorization/server'
import type { AuthorizationErrorCode } from '@repo/nuxt-authorization/server'
import { TransferError, safeTransferError } from '@repo/nuxt-import-export/server'
import { withTransferPolicy } from '../../server/transfers/policy-errors'

// Pure error-contract regression; no database, fixture dispatch, or failure injection.
describe('application transfer policy error translation', () => {
  const codes: AuthorizationErrorCode[] = ['configuration', 'invalid-input', 'unauthenticated', 'forbidden', 'not-found', 'conflict', 'timeout', 'unavailable', 'unknown']
  for (const code of codes) it(`retains ${code} in the transfer taxonomy`, async () => {
    const error = await withTransferPolicy(async () => { throw new AuthorizationError(code) }).catch(error => error)
    expect(error).toBeInstanceOf(TransferError)
    expect(error.code).toBe(code)
    expect(error.retryable).toBe(code === 'timeout' || code === 'unavailable')
    expect(safeTransferError(error)).toBe(error)
  })
  it('returns successful values without alteration', async () => {
    const value = { id: 'synthetic-project' }
    expect(await withTransferPolicy(async () => value)).toBe(value)
  })
  it('leaves non-policy failures to the existing transfer error boundary', async () => {
    const error = { code: '57014' }
    await expect(withTransferPolicy(async () => { throw error })).rejects.toBe(error)
    expect(safeTransferError(error).code).toBe('timeout')
  })
})
