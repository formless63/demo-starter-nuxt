import { defineEventHandler, getCookie, setHeader } from 'h3'

let reads = 0
export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { session: getCookie(event, 'fixture_session') ?? 'anonymous', nonce: ++reads }
})
