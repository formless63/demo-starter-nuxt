import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createOpenApiDocument,
  defineApiContract,
  defineApiRegistry,
} from '@repo/nuxt-api/server'
import { configuredAuthPlugins, configuredSocialProviders } from '../../server/utils/auth'
import { mailpitEnv } from '../../fixtures/email-consumer/.fixture/mailpit'
import { toSafeApiKey } from '../../server/utils/api-keys'

function contract(operationId: string) {
  return defineApiContract({
    method: 'get',
    path: '/api/v1/example',
    operationId,
    summary: 'Example',
    tags: ['Example'],
    responses: { 200: { description: 'Example response', schema: z.object({ ok: z.boolean() }) } },
    auth: { permissions: { example: ['read'] } },
  })
}

describe('API Platform package contracts', () => {
  it('rejects duplicate operations and operation IDs', () => {
    expect(() => defineApiRegistry(contract('duplicate'), contract('duplicate')))
      .toThrow('Duplicate API operationId')
    expect(() => defineApiRegistry(contract('first'), contract('second')))
      .toThrow('Duplicate API operation')
  })

  it('generates deterministic OpenAPI 3.1.1 security and permission metadata', () => {
    const document = createOpenApiDocument([contract('getExample')], {
      title: 'Test API',
      version: '1.0.0',
    })

    expect(document.openapi).toBe('3.1.1')
    expect(document.components?.securitySchemes?.ApiKeyAuth).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    })
    expect(document.paths?.['/api/v1/example']?.get).toMatchObject({
      operationId: 'getExample',
      security: [{ ApiKeyAuth: [] }],
      'x-required-permissions': { example: ['read'] },
    })
  })
})

describe('API Platform auth integration', () => {
  it('keeps API keys alongside optional OIDC and magic-link plugins', () => {
    for (const [key, value] of Object.entries(mailpitEnv(1025))) vi.stubEnv(key, value)
    const plugins = configuredAuthPlugins({
      oidcIssuer: 'https://id.example.test',
      oidcClientId: 'client',
      oidcClientSecret: 'secret',
      magicLinkEnabled: true,
    })

    expect(plugins.map(plugin => plugin.id)).toEqual(['api-key', 'generic-oauth', 'magic-link'])
    vi.unstubAllEnvs()
  })

  it('preserves optional GitHub provider configuration', () => {
    expect(configuredSocialProviders({ githubClientId: 'client', githubClientSecret: 'secret' }))
      .toEqual({ github: { clientId: 'client', clientSecret: 'secret' } })
  })

  it('never serializes a stored key value after creation', () => {
    const safe = toSafeApiKey({
      id: 'key-id',
      name: 'Example',
      start: 'app_1234',
      prefix: 'app_',
      key: 'stored-hash',
      enabled: true,
      permissions: { projects: ['read'] },
      expiresAt: null,
      lastRequest: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(safe).not.toHaveProperty('key')
  })
})
