import { transferService } from '../../transfers/application'
import { transferHttp } from '../../transfers/http'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event), query = getQuery(event)
  return transferHttp(() => transferService.listTransfers({ requesterId: user.id, scope: { kind: 'user', id: user.id } }, { limit: query.limit === undefined ? undefined : Number(query.limit), cursor: query.cursor === undefined ? undefined : String(query.cursor) }))
})
