import { transferService } from '../../../transfers/application'
import { transferHttp } from '../../../transfers/http'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return transferHttp(() => transferService.getTransfer({ requesterId: user.id, scope: { kind: 'user', id: user.id } }, { transferId: getRouterParam(event, 'id') ?? '', refresh: getQuery(event).refresh === 'true' }))
})
