import { send, setResponseHeaders, setResponseStatus } from 'h3'
import { defineNitroErrorHandler } from '#imports'

export default defineNitroErrorHandler((error, event) => {
  if (event.handled) return
  const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500
  const message = statusCode >= 500 ? 'Server Error' : 'The request could not be completed'
  setResponseStatus(event, statusCode)
  setResponseHeaders(event, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "script-src 'none'; frame-ancestors 'none'" })
  return send(event, JSON.stringify({ error: true, statusCode, message }))
})
