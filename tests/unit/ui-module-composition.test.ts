// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadNuxtConfig } from '@nuxt/kit'
import { createNuxt } from 'nuxt'
import { mergeConfig, resolveConfig } from 'vite'
import { expect, it } from 'vitest'
import charts from '../../packages/nuxt-charts-visualization/src/module'
import dataTable from '../../packages/nuxt-data-table/src/module'
import command from '../../packages/nuxt-command-system/src/module'
import flowCanvas from '../../packages/nuxt-flow-canvas/src/module'
import internationalization from '../../packages/nuxt-internationalization/src/module'

const chartEntries = ['echarts/core', 'echarts/renderers', 'echarts/components', 'echarts/charts']

it('composes UI modules without losing consumer or module-owned prebundles in either registration order', async () => {
  for (const modules of [[charts, dataTable, command, internationalization, flowCanvas], [flowCanvas, internationalization, command, dataTable, charts]]) {
    const root = await mkdtemp(join(tmpdir(), 'ui-module-composition-'))
    const nuxt = createNuxt(await loadNuxtConfig({ cwd: root, overrides: {
      dev: true,
      compatibilityDate: '2026-01-01',
      vite: { optimizeDeps: { include: ['clsx'], exclude: ['consumer-exclusion'], noDiscovery: true } },
    } }))
    try {
      for (const module of modules) await nuxt.runWithContext(() => module({}, nuxt))
      const config = mergeConfig({
        root, configFile: false, logLevel: 'silent',
        environments: {
          client: { optimizeDeps: { include: [], exclude: ['vue'] } },
          ssr: { optimizeDeps: { noDiscovery: true } },
        },
      }, nuxt.options.vite)
      for (const environment of ['client', 'ssr'] as const) {
        await nuxt.callHook('vite:extendConfig', { ...config, environments: { [environment]: config.environments![environment] } }, {
          isClient: environment === 'client', isServer: environment === 'ssr',
        })
      }
      const optimizer = (await resolveConfig(config, 'serve')).environments.client!.optimizeDeps
      expect(optimizer.include).toEqual(expect.arrayContaining(['clsx', '@tanstack/vue-table', 'vue-i18n', '@vue-flow/core', ...chartEntries]))
      expect(optimizer.exclude).toEqual(expect.arrayContaining(['consumer-exclusion', 'vue']))
      expect(optimizer.noDiscovery).toBe(true)
      for (const nativeEntry of ['vue-i18n', '@vue-flow/core']) {
        expect(optimizer.include.filter(entry => entry === nativeEntry)).toHaveLength(1)
      }
    }
    finally {
      await nuxt.close()
      await rm(root, { recursive: true, force: true })
    }
  }
})
