import { getHeader } from 'h3'
import type { H3Event } from 'h3'
import { useServerAuth } from '#api-platform-auth'
import type { ApiPermissions } from './contracts'
import { apiError } from './http'

export { defineApiHandler, parseApiResponse, readApiBody } from './http'

export interface ApiPrincipal {
  type: 'user'
  userId: string
  keyId: string
  permissions: ApiPermissions
}

function hasPermissions(actual: ApiPermissions, required: ApiPermissions) {
  return Object.entries(required).every(([resource, actions]) =>
    actions.every(action => actual[resource]?.includes(action)),
  )
}

export async function requireApiKey(
  event: H3Event,
  requiredPermissions: ApiPermissions,
): Promise<ApiPrincipal> {
  const key = getHeader(event, 'x-api-key')?.trim()
  if (!key) apiError(401, 'unauthorized', 'A valid API key is required')

  const result = await useServerAuth().api.verifyApiKey({ body: { key } })
  if (!result.valid || !result.key) {
    if (result.error?.code === 'RATE_LIMITED') {
      apiError(429, 'rate_limited', 'API key rate limit exceeded')
    }
    apiError(401, 'unauthorized', 'A valid API key is required')
  }

  const permissions = result.key.permissions && typeof result.key.permissions === 'object'
    ? result.key.permissions as ApiPermissions
    : {}
  if (!hasPermissions(permissions, requiredPermissions)) {
    apiError(403, 'forbidden', 'API key lacks a required permission')
  }

  return {
    type: 'user',
    userId: result.key.referenceId,
    keyId: result.key.id,
    permissions,
  }
}
