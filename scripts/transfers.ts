import { transferService, closeTransferResources } from '../server/transfers/application'
import { safeTransferError } from '@repo/nuxt-import-export/server'
try {
  const [operation, ...args] = process.argv.slice(2), execute = args.includes('--execute'), ids = args.filter(value => value !== '--execute')
  if (!ids.length || !['reconcile', 'purge'].includes(operation ?? '')) throw new Error('invalid-input')
  const result = operation === 'reconcile' ? await transferService.reconcileTransfers(ids) : await transferService.purgeTransferArtifacts(ids, { execute })
  console.info(JSON.stringify(result))
}
catch (error) { console.error(JSON.stringify(safeTransferError(error))); process.exitCode = 1 }
finally { await closeTransferResources() }
