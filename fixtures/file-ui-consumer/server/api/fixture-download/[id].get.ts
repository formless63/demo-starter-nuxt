import { defineEventHandler, setHeaders } from 'h3'
export default defineEventHandler((event) => {
  setHeaders(event, {
    'content-type': 'application/octet-stream',
    'content-disposition': 'attachment; filename="fixture.txt"',
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
  })
  return 'fixture attachment\n'
})
