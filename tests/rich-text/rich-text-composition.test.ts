// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadNuxtConfig } from '@nuxt/kit'
import { createNuxt } from 'nuxt'
import { mergeConfig, resolveConfig } from 'vite'
import { expect, test } from 'vitest'
import dataTable from '../../packages/nuxt-data-table/src/module'
import charts from '../../packages/nuxt-charts-visualization/src/module'
import command from '../../packages/nuxt-command-system/src/module'
import markdown from '../../packages/nuxt-markdown-code/src/module'
import richText from '../../packages/nuxt-rich-text/src/module'
import storage from '../../packages/nuxt-storage/src/module'
import fileUi from '../../packages/nuxt-file-ui/src/module'

test('accepted UI modules compose optimizer entries, Markdown server boundary and caller settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuxt-rich-text-composition-'))
  const options = await loadNuxtConfig({ cwd: root, overrides: {
    dev: true, compatibilityDate: '2026-01-01',
    vite: { optimizeDeps: { include: ['clsx'], exclude: ['consumer-exclusion'], noDiscovery: true }, plugins: [{ name: 'consumer-plugin' }] },
  } })
  const nuxt = createNuxt(options)
  try {
    for (const module of [dataTable, charts, command, markdown, richText, storage, fileUi]) await nuxt.runWithContext(() => module({}, nuxt))
    const config = mergeConfig({ root, configFile: false, logLevel: 'silent', environments: { client: { optimizeDeps: { include: [], exclude: ['vue'] } }, ssr: { optimizeDeps: { noDiscovery: true } } } }, nuxt.options.vite)
    for (const environment of ['client', 'ssr'] as const) await nuxt.callHook('vite:extendConfig', { ...config, environments: { [environment]: config.environments![environment] } }, { isClient: environment === 'client', isServer: environment === 'ssr' })
    const resolved = await resolveConfig(config, 'serve')
    expect(resolved.environments.client!.optimizeDeps.include).toEqual(expect.arrayContaining(['clsx', '@tanstack/vue-table', '@tiptap/vue-3', '@tiptap/core', '@tiptap/pm/state', '@tiptap/starter-kit', 'echarts/core']))
    expect(resolved.environments.client!.optimizeDeps.exclude).toEqual(expect.arrayContaining(['consumer-exclusion', 'vue']))
    expect(resolved.environments.client!.optimizeDeps.noDiscovery).toBe(true)
    expect(resolved.plugins.map(plugin => plugin.name)).toEqual(expect.arrayContaining(['consumer-plugin', 'nuxt-markdown-server-boundary']))
    expect(nuxt.options.css.some(path => path.endsWith('markdown-code.css'))).toBe(true)
  }
  finally { await nuxt.close(); await rm(root, { recursive: true, force: true }) }
})
