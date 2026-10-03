import { defineEventHandler, setCookie } from 'h3'

export default defineEventHandler((event) => {
  setCookie(event, 'fixture_session', 'private-user', { path: '/', sameSite: 'lax', httpOnly: true })
  return { ok: true }
})
