import { describe, expect, it } from 'vitest'
import { projectInput } from '../../server/utils/project-input'

describe('project input', () => {
  it('normalizes valid input', () => {
    expect(projectInput.parse({ name: ' Work ', description: '' }))
      .toEqual({ name: 'Work', description: null })
  })

  it('rejects blank and oversized names', () => {
    expect(() => projectInput.parse({ name: ' ' })).toThrow()
    expect(() => projectInput.parse({ name: 'x'.repeat(121) })).toThrow()
  })
})
