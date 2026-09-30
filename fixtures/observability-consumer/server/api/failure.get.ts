import { captureException, withSpan } from '@repo/nuxt-observability/server'

export default defineEventHandler(async (event) => {
  // Exercise safe capture while keeping the response independent of internal error text.
  await withSpan('fixture.failure', () => {
    captureException(new Error('FAILURE_SECRET postgres://user:ERROR_SECRET@localhost/db'))
  })
  setResponseStatus(event, 500)
  return { error: { code: 'internal_error', message: 'An internal error occurred' } }
})
