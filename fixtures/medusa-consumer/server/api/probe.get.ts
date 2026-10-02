import { environmentConnection, safeError } from '@repo/nuxt-medusa/server'
export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  try { environmentConnection(); return { configured: true } }
  catch (error) { const safe = safeError(error); setResponseStatus(event, safe.status); return safe.public() }
})
