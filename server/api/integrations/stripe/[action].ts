import { stripeService } from '../../../stripe/application'
import { stripeHttp, rawBody } from '../../../stripe/http'
import { validate, checkoutInput, operationInput, bindingInput, reconcileInput, listInput, StripeCapabilityError } from '@repo/nuxt-stripe/server'
export default defineEventHandler(event => stripeHttp(event, async (signal) => {
  let user
  try { user = await requireUser(event) } catch { throw new StripeCapabilityError('unauthenticated') }
  const context = { actorUserId: user.id, scope: { kind: 'user' as const, id: user.id }, signal }
  const action = getRouterParam(event, 'action'), method = event.method
  const input = method === 'GET' ? getQuery(event) : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await rawBody(event, signal, 256 * 1024))) as unknown
  if (action === 'checkout' && method === 'POST') return stripeService.requestCheckout(context, validate(checkoutInput, input))
  if (action === 'checkout' && method === 'GET') return stripeService.getCheckout(context, validate(bindingInput, input))
  if (action === 'operation' && method === 'GET') return stripeService.getOperation(context, validate(operationInput, input))
  if (action === 'reconcile' && method === 'POST') return stripeService.requestPaymentReconciliation(context, validate(reconcileInput, input))
  if (action === 'cancel' && method === 'POST') return stripeService.cancelOperation(context, validate(operationInput, input))
  if (action === 'payments' && method === 'GET') { const query = getQuery(event); return stripeService.listPayments(context, validate(listInput, { ...query, ...(query.limit === undefined ? {} : { limit: Number(query.limit) }) })) }
  throw new StripeCapabilityError('not_found')
}))
