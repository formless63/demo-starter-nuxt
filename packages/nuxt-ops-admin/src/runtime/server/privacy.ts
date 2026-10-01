import { defineEventHandler, getRequestURL, setHeader } from 'h3'
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (path === '/admin/ops' || path.startsWith('/api/ops/')) {
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'Vary', 'Cookie')
  }
})
