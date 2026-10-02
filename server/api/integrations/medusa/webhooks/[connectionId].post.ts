import { getRouterParam, toWebRequest } from 'h3'
import { medusaService } from '../../../../medusa/application'
import { medusaHttp } from '../../../../medusa/http'
export default defineEventHandler(event => medusaHttp(event, async (signal) => {
  const request = toWebRequest(event)
  return medusaService.receive(new Request(request, { signal, duplex: 'half' } as RequestInit), getRouterParam(event, 'connectionId') ?? '')
}))
