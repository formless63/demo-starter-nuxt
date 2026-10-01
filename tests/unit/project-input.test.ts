import { describe, expect, it } from 'vitest'
import { projectInput } from '../../server/utils/project-input'
import { createProjectBodySchema, apiContracts } from '../../server/api-platform/contracts'
import { createOpenApiDocument } from '@repo/nuxt-api/server'

describe('project input', () => {
  it('normalizes valid input', () => {
    expect(projectInput.parse({ name: ' Work ', description: '' }))
      .toEqual({ name: 'Work', description: null })
  })

  it('rejects blank and oversized names', () => {
    expect(() => projectInput.parse({ name: ' ' })).toThrow()
    expect(() => projectInput.parse({ name: 'x'.repeat(121) })).toThrow()
  })

  it('keeps browser and machine input limits aligned at 120/1000 in OpenAPI', () => {
    const boundary = { name: 'n'.repeat(120), description: 'd'.repeat(1000) }
    for (const input of [projectInput, createProjectBodySchema]) {
      expect(input.parse(boundary)).toEqual(boundary)
      expect(input.safeParse({ ...boundary, name: 'n'.repeat(121) }).success).toBe(false)
      expect(input.safeParse({ ...boundary, description: 'd'.repeat(1001) }).success).toBe(false)
    }
    const document = createOpenApiDocument(apiContracts, { title: 'Projects', version: '1' })
    expect(document.components?.schemas?.CreateProject).toMatchObject({
      properties: { name: { maxLength: 120 }, description: { maxLength: 1000 } },
    })
  })
})
