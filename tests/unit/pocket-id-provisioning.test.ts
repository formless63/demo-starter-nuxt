import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('Pocket ID provisioning contract', () => {
  it('uses the current auth callback and API-key/client-secret endpoints', async () => {
    const source = await readFile('scripts/provision-oidc.ts', 'utf8')
    expect(source).toContain("'X-API-KEY': apiKey")
    expect(source).toContain('/api/auth/callback/oidc')
    expect(source).toContain('/secrets`')
    expect(source).not.toContain('/api/auth/oauth2/callback/oidc')
  })
})
