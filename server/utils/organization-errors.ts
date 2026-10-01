import { AuthorizationError } from '@repo/nuxt-authorization/server'
import { safeOrganizationError, OrganizationError } from '@repo/nuxt-organizations/server'

export function organizationHttpError(error: unknown) {
  const safe = error instanceof AuthorizationError ? new OrganizationError(error.code) : safeOrganizationError(error)
  const statuses = { configuration: 500, 'invalid-input': 400, unauthenticated: 401, forbidden: 403, 'not-found': 404, conflict: 409, 'limit-exceeded': 413, expired: 409, unsupported: 422, timeout: 504, unavailable: 503, unknown: 500 } as const
  return createError({ statusCode: statuses[safe.code], statusMessage: safe.message, data: safe.toJSON() })
}
