import { transferService } from '../../transfers/application'
import { transferHttp } from '../../transfers/http'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return transferHttp(() => transferService.stageImport({ requesterId: user.id, scope: { kind: 'user', id: user.id } }, { definition: 'projects', body: event.node.req }))
})
