import { getQuery, getRouterParam, getMethod } from 'h3'
import { medusaService, userContext } from '../../../medusa/application'
import { medusaHttp, readInput } from '../../../medusa/http'
import { parse, bindingRef, operationRef, listInput, reconcileInput, syncInput, MedusaError } from '@repo/nuxt-medusa/server'
export default defineEventHandler(event => medusaHttp(event, async (signal) => {
  const user = await requireUser(event), ctx = userContext(user.id, signal), path = getRouterParam(event, 'path'), method = getMethod(event)
  if (method === 'GET') {
    const query = getQuery(event)
    if (path === 'product') return medusaService.getProduct(ctx, parse(bindingRef, query))
    if (path === 'order') return medusaService.getOrder(ctx, parse(bindingRef, query))
    if (path === 'operation') return medusaService.getOperation(ctx, parse(operationRef, query))
    if (path === 'sync-result') return medusaService.getSyncResult(ctx, parse(operationRef, query))
    const input = { ...query, ...(query.limit === undefined ? {} : { limit: Number(query.limit) }) }
    if (path === 'products') return medusaService.listProducts(ctx, parse(listInput, input))
    if (path === 'orders') return medusaService.listOrders(ctx, parse(listInput, input))
  }
  if (method === 'POST') {
    const input = await readInput(event, signal)
    if (path === 'reconcile') return medusaService.requestResourceReconciliation(ctx, parse(reconcileInput, input))
    if (path === 'sync') return medusaService.requestSyncPage(ctx, parse(syncInput, input))
    if (path === 'cancel') return medusaService.cancelOperation(ctx, parse(operationRef, input))
  }
  throw new MedusaError('not_found')
}))
