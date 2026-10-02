import { Readable } from 'node:stream'
import { invoiceNinjaService } from '~~/server/invoice-ninja/application'
import { invoiceHttp, requestSignal } from '~~/server/invoice-ninja/http'
import { InvoiceNinjaError } from '@repo/nuxt-invoice-ninja/server'
export default defineEventHandler(event => invoiceHttp(event, async () => {
  const count = event.node.req.rawHeaders.filter((_, i) => i % 2 === 0 && event.node.req.rawHeaders[i]!.toLowerCase() === 'x-invoice-ninja-webhook-secret').length
  if (count !== 1) throw new InvoiceNinjaError('invalid_input')
  return invoiceNinjaService.receiveWebhook(getRouterParam(event, 'connectionId') ?? '', getRouterParam(event, 'eventKind') ?? '', getHeader(event, 'x-invoice-ninja-webhook-secret'), Readable.toWeb(event.node.req) as ReadableStream<Uint8Array>, requestSignal(event))
}))
