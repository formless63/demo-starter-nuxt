import { invoiceNinjaService } from '~~/server/invoice-ninja/application'
import { invoiceContext, invoiceHttp } from '~~/server/invoice-ninja/http'
export default defineEventHandler(event => invoiceHttp(event, async () => {
  return invoiceNinjaService.getClient(await invoiceContext(event), { bindingId: getRouterParam(event, 'bindingId') })
}))
