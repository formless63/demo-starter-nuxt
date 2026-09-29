import { z } from 'zod'

export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(32),
  permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }).refine(value => value.read || value.write, 'Select at least one permission'),
  expiresInDays: z.number().int().min(1).max(3650).nullable(),
})

export function toSafeApiKey(key: {
  id: string
  name: string | null
  start: string | null
  prefix: string | null
  enabled: boolean
  permissions: unknown
  expiresAt: Date | null
  lastRequest: Date | null
  createdAt: Date
}) {
  return {
    id: key.id,
    name: key.name,
    start: key.start,
    prefix: key.prefix,
    enabled: key.enabled,
    permissions: key.permissions,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastRequest?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  }
}
