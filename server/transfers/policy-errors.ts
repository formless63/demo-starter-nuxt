import { AuthorizationError } from '@repo/nuxt-authorization/server'
import { TransferError } from '@repo/nuxt-import-export/server'

/** Preserve the transfer service's closed retry/denial taxonomy at app policy boundaries. */
export async function withTransferPolicy<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof AuthorizationError) throw new TransferError(error.code)
    // Leave non-policy errors to the existing transfer boundary and SQLSTATE mapping.
    throw error
  }
}
