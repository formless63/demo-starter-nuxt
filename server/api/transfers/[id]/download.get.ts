import { transferService } from '../../../transfers/application'
import { transferHttp } from '../../../transfers/http'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return transferHttp(() => transferService.getExportDownload({ requesterId: user.id, scope: { kind: 'user', id: user.id } }, { transferId: getRouterParam(event, 'id') ?? '' }))
})
