import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from '../../app/lib/safe-redirect'

describe('safe redirect path', () => {
  it('preserves internal application destinations', () => {
    expect(safeRedirectPath('/app/projects?view=recent#project-list'))
      .toBe('/app/projects?view=recent#project-list')
  })

  it.each([
    'https://example.com/app/projects',
    '//example.com/app/projects',
    '/\\example.com/app/projects',
    '/%2f%2fexample.com/app/projects',
    '/%5cexample.com/app/projects',
    'app/projects',
    '',
    undefined,
    ['/app/projects'],
  ])('uses the default destination for unsafe input %#', (value) => {
    expect(safeRedirectPath(value)).toBe('/app/projects')
  })
})
