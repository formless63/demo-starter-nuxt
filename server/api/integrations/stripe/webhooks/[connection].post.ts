import { stripeService } from '../../../../stripe/application'
import { stripeHttp, rawBody } from '../../../../stripe/http'
import { StripeCapabilityError, validate, connectionId } from '@repo/nuxt-stripe/server'
export default defineEventHandler(event => stripeHttp(event, async (signal) => {
  const signature = getHeader(event, 'stripe-signature')
  if (!signature) throw new StripeCapabilityError('invalid_input')
  if (Buffer.byteLength(signature) > 8192) throw new StripeCapabilityError('limit_exceeded')
  // Reject duplicate signature header lines; multiple v1 signatures in one header remain supported.
  const names = event.node.req.rawHeaders.filter((_, index) => index % 2 === 0)
  if (names.filter(name => name.toLowerCase() === 'stripe-signature').length !== 1) throw new StripeCapabilityError('invalid_input')
  const raw = await rawBody(event, signal, 1024 * 1024)
  return stripeService.receive(validate(connectionId, getRouterParam(event, 'connection')), raw, signature, signal)
}, true))
