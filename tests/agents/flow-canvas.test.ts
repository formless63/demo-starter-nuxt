import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mergeFlowOptimizeDeps } from '../../packages/nuxt-flow-canvas/src/vite'

test('Flow owns setup-time dependency discovery without replacing caller settings', () => {
  const config = { optimizeDeps: { include: ['caller-owned', '@vue-flow/core'], exclude: ['caller-excluded'], force: true }, server: { port: 8123 } }
  const result = mergeFlowOptimizeDeps(config)
  expect(result).toBe(config)
  expect(result.optimizeDeps.include).toEqual(['caller-owned', '@vue-flow/core'])
  expect(result.optimizeDeps.exclude).toEqual(['caller-excluded'])
  expect(result.optimizeDeps.force).toBe(true)
  expect(result.server.port).toBe(8123)
  const source = readFileSync(new URL('../../packages/nuxt-flow-canvas/src/module.ts', import.meta.url), 'utf8')
  expect(source).toContain('mergeFlowOptimizeDeps(nuxt.options.vite)')
  expect(source).not.toContain('vite:extendConfig')
})

test('Flow reference stays authored in-progress with no dependency or migration inflation', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../capabilities/catalog.json', import.meta.url), 'utf8'))
  const entry = catalog.capabilities.find((item: { id: string }) => item.id === 'flow-canvas')
  expect(entry.status).toBe('in-progress')
  expect(entry.requires).toEqual([])
  expect(entry.defaultInstalled).toBe(false)
  expect(entry.migrations).toEqual([])
  expect(entry.packageTest.runtimeScript).toBe('package:test:runtime')
})

test('Vendor IDs safely encode quotes, brackets, Unicode and separators without collisions', async () => {
  const { flowVendorId } = await import('../../packages/nuxt-flow-canvas/src/runtime/vendor-id')
  const original = ['a', 'a_b', 'a"[data-id="b', 'node\nnext', 'é', '🧭', 'n_61']
  const encoded = original.map(flowVendorId)
  expect(new Set(encoded).size).toBe(original.length)
  for (const id of encoded) expect(id).toMatch(/^n_[a-f0-9_]*$/)
})
