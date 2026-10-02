// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'

it('resolves zrender’s exact tslib dependency from its own importer', () => {
  const require = createRequire(import.meta.url)
  const zrenderManifest = require.resolve('zrender/package.json')
  const zrender = JSON.parse(readFileSync(zrenderManifest, 'utf8'))
  const fromZrender = createRequire(zrenderManifest)
  // tslib 2.3.0 does not export package.json. Resolve its actual JS entry,
  // then inspect the adjacent manifest, including any nested installation.
  const tslib = JSON.parse(readFileSync(join(dirname(fromZrender.resolve('tslib')), 'package.json'), 'utf8'))
  expect(zrender.dependencies.tslib).toBe('2.3.0')
  expect(tslib.version).toBe(zrender.dependencies.tslib)
})
