import { z } from 'zod'
import { TransferError } from '@repo/nuxt-import-export/server'
import { transferService } from '../../../transfers/application'
import { transferHttp } from '../../../transfers/http'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return transferHttp(async () => {
    const result = z.object({ idempotencyKey: z.string() }).strict().safeParse(await readBody(event))
    if (!result.success) throw new TransferError('invalid-input')
    return transferService.startImport({ requesterId: user.id, scope: { kind: 'user', id: user.id } }, { transferId: getRouterParam(event, 'id') ?? '', ...result.data })
  })
})
