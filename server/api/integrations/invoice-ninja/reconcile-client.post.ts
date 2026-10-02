import { invoiceNinjaService } from '~~/server/invoice-ninja/application'
import { invoiceContext, invoiceHttp, invoiceBody } from '~~/server/invoice-ninja/http'
export default defineEventHandler(event => invoiceHttp(event, async () => {
  const context = await invoiceContext(event)
  return invoiceNinjaService.requestClientReconciliation(context, await invoiceBody(event))
}))
