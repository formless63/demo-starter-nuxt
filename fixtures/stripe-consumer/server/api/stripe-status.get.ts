import { connectionFromEnvironment, safeError } from '@repo/nuxt-stripe/server'
export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  try { const connection = connectionFromEnvironment(); return { configured: true, mode: connection.mode } }
  catch (error) { const safe = safeError(error); setResponseStatus(event, safe.statusCode); return { error: safe.public() } }
})
