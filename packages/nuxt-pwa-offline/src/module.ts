import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addComponent, createResolver, defineNuxtModule, installModule } from '@nuxt/kit'
import { publicAssets, workerFilename } from './runtime/constants'
import { validBase, validPublicPath } from './runtime/policy'

export interface ModuleOptions { base?: string; publicOfflinePaths: string[]; retired: boolean }

export default defineNuxtModule<ModuleOptions>({
  meta: { name: '@repo/nuxt-pwa-offline', configKey: 'pwaOffline', compatibility: { nuxt: '>=4.0.0 <5.0.0' } },
  defaults: { publicOfflinePaths: [], retired: false },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const runtimeFile = (name: string) => {
      const js = resolver.resolve(`./runtime/${name}.js`)
      return existsSync(js) ? js : resolver.resolve(`./runtime/${name}.ts`)
    }
    const base = options.base ?? nuxt.options.app.baseURL
    if (!validBase(base) || base !== nuxt.options.app.baseURL || !options.publicOfflinePaths.every(validPublicPath)) throw new Error('PWA base must equal Nuxt app.baseURL and public paths must be explicit safe paths')
    if (nuxt.options.modules.some(entry => entry === '@vite-pwa/nuxt')) throw new Error('PWA module owns native @vite-pwa/nuxt configuration; remove duplicate module')
    const config = { base, publicOfflinePaths: [...options.publicOfflinePaths], retired: options.retired }
    const assetsDir = resolver.resolve('./runtime/public')
    const entries = await Promise.all(publicAssets.map(async (url) => {
      const bytes = await readFile(join(assetsDir, url))
      const revision = createHash('sha256').update(bytes).digest('hex')
      if (url.endsWith('.png') && !url.includes(revision.slice(0, 16))) throw new Error('PWA icon fingerprint mismatch')
      return { url, revision, integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`, size: bytes.length }
    }))
    const template = await readFile(resolver.resolve('./runtime/worker-template.txt'), 'utf8')
    const version = createHash('sha256').update(JSON.stringify(entries)).update(JSON.stringify(config)).update(template)
      .update(await readFile(runtimeFile('policy'))).update(await readFile(fileURLToPath(import.meta.url)))
      .update('@vite-pwa/nuxt@1.1.1/vite-plugin-pwa@1.3.0/workbox-build@7.4.1').digest('hex')
    const sourceDir = join(nuxt.options.buildDir, 'pwa-offline')
    const prepare = async () => {
      await mkdir(sourceDir, { recursive: true })
      const source = template.replace('"./constants"', JSON.stringify(runtimeFile('constants')))
        .replace('"./policy"', JSON.stringify(runtimeFile('policy')))
      await writeFile(join(sourceDir, 'pwa-offline-sw.ts'), source, 'utf8')
    }
    // Nuxt clears generated sources during prepare: recreate before Vite resolves
    // and again at the native final build hook, not just at module setup.
    nuxt.hook('vite:extendConfig', prepare)
    nuxt.options.nitro.publicAssets ||= []
    nuxt.options.nitro.publicAssets.push({ dir: assetsDir, maxAge: 0 })
    nuxt.options.routeRules ||= {}
    for (const asset of publicAssets) {
      nuxt.options.routeRules[`/${asset}`] = { headers: {
        'Content-Type': asset.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8',
        'Cache-Control': asset.endsWith('.png') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      } }
    }
    nuxt.options.routeRules[`/${workerFilename}`] = { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } }
    nuxt.options.runtimeConfig.public.pwaOffline = { base, retired: options.retired }
    if (!options.retired) {
      nuxt.options.app.head.link ||= []
      nuxt.options.app.head.link.push({ rel: 'manifest', href: `${base}manifest.webmanifest` })
      addComponent({ name: 'PwaPanel', filePath: resolver.resolve('./runtime/components/PwaPanel.vue') })
    }
    let outputDirectory = ''
    await installModule('@vite-pwa/nuxt', {
      strategies: 'injectManifest', srcDir: sourceDir, filename: 'pwa-offline-sw.ts',
      injectRegister: false, registerType: 'prompt', client: { registerPlugin: false },
      base, scope: base, includeAssets: [], includeManifestIcons: false, devOptions: { enabled: false },
      manifest: options.retired ? false : {
        id: base, name: 'Public offline demo', short_name: 'Offline demo', description: 'Public fallback only; account content requires a connection.',
        start_url: base, scope: base, display: 'standalone', theme_color: '#1f455e', background_color: '#ffffff',
        icons: publicAssets.slice(1).map((url, i) => ({ src: `${base}${url}`, sizes: i === 0 ? '192x192' : '512x512', type: 'image/png', purpose: 'any' })),
      },
      integration: { async beforeBuildServiceWorker(resolved) {
        await prepare()
        outputDirectory = resolved.outDir
        // Native Nuxt adds payload and app-manifest globs, while PWA adds its manifest.
        // Clear both only after native configuration has run.
        resolved.injectManifest.globPatterns = []
        resolved.injectManifest.additionalManifestEntries = []
      } },
      injectManifest: {
        globPatterns: [], globIgnores: ['**/_payload.json', '**/_nuxt/**', '**/manifest.webmanifest', '**/api/**', '**/uploads/**'],
        rollupFormat: 'iife',
        buildPlugins: { vite: [{ name: 'pwa-owned-defines', config: () => ({ define: { __PWA_OFFLINE_CONFIG__: JSON.stringify(config), __PWA_OFFLINE_VERSION__: JSON.stringify(version) } }) }] },
        manifestTransforms: [async (manifest) => {
          if (manifest.length !== 0) throw new Error('Unexpected native PWA precache entries')
          return { manifest: entries.map(entry => ({ ...entry })), warnings: [] }
        }],
      },
    })
    nuxt.hook('nitro:build:public-assets', async () => {
      if (nuxt.options.dev) return
      const emitted = await readFile(join(outputDirectory, workerFilename), 'utf8')
      const rawManifest = emitted.match(/\[\{"integrity":.*?\}\]/)?.[0]
      if (!rawManifest) throw new Error('Missing exact emitted PWA manifest')
      assert.deepEqual(JSON.parse(rawManifest), entries.map(({ url, revision, integrity }) => ({ url, revision, integrity })), 'Emitted worker must contain exactly the reviewed public manifest')
    })
  },
})
