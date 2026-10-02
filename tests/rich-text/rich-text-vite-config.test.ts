// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadNuxtConfig } from '@nuxt/kit'
import { createNuxt } from 'nuxt'
import { mergeConfig, resolveConfig } from 'vite'
import { describe, expect, it } from 'vitest'
import richTextModule from '../../packages/nuxt-rich-text/src/module'

const tableEntries = ['@tiptap/vue-3', '@tiptap/core', '@tiptap/pm/state', '@tiptap/starter-kit']

async function resolveConsumerConfig(enabled: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'rich-text-vite-config-'))
  const options = await loadNuxtConfig({ cwd: root, overrides: {
    dev: true,
    compatibilityDate: '2026-01-01',
    vite: { optimizeDeps: { include: ['clsx'], exclude: ['consumer-exclusion'], noDiscovery: true } },
  } })
  const nuxt = createNuxt(options)
  try {
    if (enabled) await nuxt.runWithContext(() => richTextModule({}, nuxt))
    // Nuxt 4.5.2's Environment API builds the original config, but invokes
    // vite:extendConfig on shallow per-environment copies (handleEnvironments
    // in @nuxt/vite-builder). Replacing a copy's optimizeDeps loses the change.
    const config = mergeConfig({
      root, configFile: false, logLevel: 'silent',
      environments: {
        client: { optimizeDeps: { include: [], exclude: ['vue'] } },
        ssr: { optimizeDeps: { noDiscovery: true } },
      },
    }, nuxt.options.vite)
    for (const environment of ['client', 'ssr'] as const) {
      const strippedConfig = { ...config, environments: { [environment]: config.environments![environment] } }
      await nuxt.callHook('vite:extendConfig', strippedConfig, { isClient: environment === 'client', isServer: environment === 'ssr' })
    }
    return (await resolveConfig(config, 'serve')).environments.client!.optimizeDeps
  }
  finally {
    await nuxt.close()
    await rm(root, { recursive: true, force: true })
  }
}

describe('Rich Text Nuxt Environment API configuration', () => {
  it('keeps module-owned entries in the actual Vite client config and preserves caller settings', async () => {
    const config = await resolveConsumerConfig(true)
    expect(config.include).toEqual(expect.arrayContaining(['clsx', ...tableEntries]))
    expect(config.exclude).toEqual(expect.arrayContaining(['consumer-exclusion', 'vue']))
    expect(config.noDiscovery).toBe(true)
  })

  it('does not install table prebundles when the module is absent', async () => {
    const config = await resolveConsumerConfig(false)
    expect(config.include).toContain('clsx')
    for (const entry of tableEntries) expect(config.include).not.toContain(entry)
  })
})
