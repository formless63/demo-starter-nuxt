import { invoiceNinjaService } from '~~/server/invoice-ninja/application'
import { invoiceContext, invoiceHttp, invoiceQuery } from '~~/server/invoice-ninja/http'
export default defineEventHandler(event => invoiceHttp(event, async () => {
  return invoiceNinjaService.listInvoices(await invoiceContext(event), invoiceQuery(event))
}))
