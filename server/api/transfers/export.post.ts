import { z } from 'zod'
import { transferService } from '../../transfers/application'
import { transferHttp } from '../../transfers/http'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return transferHttp(async () => {
    const result = z.object({ idempotencyKey: z.string() }).strict().safeParse(await readBody(event))
    if (!result.success) throw new (await import('@repo/nuxt-import-export/server')).TransferError('invalid-input')
    return transferService.requestExport({ requesterId: user.id, scope: { kind: 'user', id: user.id } }, { definition: 'projects', ...result.data })
  })
})
