import { applicationPolicy, personalPolicyContext } from '../../utils/application-policy'
import { AuthorizationError } from '@repo/nuxt-authorization/server'
export default defineEventHandler(async event => {
  const user = await requireUser(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  try {
    await applicationPolicy.requirePermission(useDb(), personalPolicyContext(user.id), 'dashboard.beta.read')
    return { message: 'Your read-only preview access is active.' }
  }
  catch(error) {
    const code = error instanceof AuthorizationError ? error.code : 'unavailable'
    throw createError({ statusCode: code === 'forbidden' ? 403 : code === 'timeout' ? 504 : 503, statusMessage: code === 'forbidden' ? 'Permission denied' : 'Preview unavailable', data: { code } })
  }
})
