// @vitest-environment node
import { loadNuxtConfig } from '@nuxt/kit'
import { describe, expect, it } from 'vitest'

describe('reference application cold-start dependencies', () => {
  it('prebundles the Nuxt diagnostic imports before the first browser entry request', async () => {
    const config = await loadNuxtConfig({ rootDir: process.cwd() })
    expect(config.vite.optimizeDeps?.include).toEqual(expect.arrayContaining([
      'errx', 'nostics', 'nostics/formatters/ansi', 'nostics/reporters/dev',
      '@tabler/icons-vue', 'better-auth/vue',
    ]))
  })
})
