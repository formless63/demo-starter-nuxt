// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildNuxt, loadNuxt } from '@nuxt/kit'
import { expect, it } from 'vitest'

it('prebundles the enabled DevTools runtime imports before the first client page', async () => {
  const root = process.cwd()
  const runtime = await readFile(join(root, 'node_modules/@nuxt/devtools/dist/runtime/vue-devtools-client.js'), 'utf8')
  const imports = [...runtime.matchAll(/from ["'](@vue\/devtools-[^"']+)["']/g)].map(match => match[1]!)
  expect(imports.sort()).toEqual(['@vue/devtools-core', '@vue/devtools-kit'])
  const buildDir = await mkdtemp(join(tmpdir(), 'nuxt-bootstrap-config-'))
  const nuxt = await loadNuxt({ cwd: root, dev: true, overrides: { buildDir, typescript: { typeCheck: false } } })
  const captured = new Error('resolved-client-config-captured')
  let include: string[] | undefined
  try {
    expect(nuxt.options.devtools).toMatchObject({ enabled: true })
    // Exercise the real Nuxt builder/module chain, stopping at resolved config
    // before Vite or Nitro starts a server. No network/browser is required.
    nuxt.hook('vite:configResolved', (config, environment) => {
      if (!environment.isClient) return
      include = config.environments?.client?.optimizeDeps?.include ?? config.optimizeDeps?.include
      throw captured
    })
    await expect(buildNuxt(nuxt)).rejects.toBe(captured)
    expect(include).toEqual(expect.arrayContaining(imports))
    expect(include).toEqual(expect.arrayContaining(['errx', 'nostics', 'nostics/formatters/ansi', 'nostics/reporters/dev', 'better-auth/vue', 'reka-ui']))
  }
  finally {
    await nuxt.close()
    await rm(buildDir, { recursive: true, force: true })
  }
}, 30_000)
