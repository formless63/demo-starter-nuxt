import { apiKey } from '@better-auth/api-key'
import type { ApiKeyConfigurationOptions } from '@better-auth/api-key'

export type ApiPlatformAuthOptions = Pick<
  ApiKeyConfigurationOptions,
  | 'defaultKeyLength'
  | 'defaultPrefix'
  | 'enableMetadata'
  | 'keyExpiration'
  | 'maximumNameLength'
  | 'minimumNameLength'
  | 'rateLimit'
  | 'startingCharactersConfig'
>

export function apiPlatformAuth(options: ApiPlatformAuthOptions = {}) {
  return apiKey({
    ...options,
    apiKeyHeaders: 'X-API-Key',
    defaultKeyLength: options.defaultKeyLength ?? 64,
    defaultPrefix: options.defaultPrefix ?? 'app_',
    disableKeyHashing: false,
    enableMetadata: options.enableMetadata ?? true,
    enableSessionForAPIKeys: false,
    keyExpiration: {
      defaultExpiresIn: null,
      minExpiresIn: 1,
      maxExpiresIn: 3650,
      ...options.keyExpiration,
    },
    rateLimit: {
      enabled: true,
      timeWindow: 60_000,
      maxRequests: 1_000,
      ...options.rateLimit,
    },
    references: 'user',
    requireName: true,
    storage: 'database',
  })
}
