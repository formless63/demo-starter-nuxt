import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const window = new Window({ url: 'https://fixture.invalid' })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent'] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] })
const { createApp, h, shallowRef, nextTick } = await import('vue')
const { MarkdownContent } = await import('@repo/nuxt-markdown-code/components')
const documentValue = shallowRef({ version: 1 as const, nodes: [{ kind: 'code' as const, text: 'first\n', language: 'text' }] })
const container = window.document.createElement('div')
window.document.body.append(container)
let resolveCopy: () => void = () => {}
const copied: string[] = []
Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { copied.push(text); return new Promise<void>(resolve => { resolveCopy = resolve }) } } })
const app = createApp({ render: () => h(MarkdownContent, { document: documentValue.value }) })
app.mount(container)
await nextTick()
const button = () => container.querySelector('button')!
const status = () => container.querySelector('output')!.textContent
button().click()
await nextTick()
assert.equal(status(), 'Copying')
assert.equal(button().disabled, true)
button().click()
assert.deepEqual(copied, ['first\n'], 'Repeated pending click is ignored')
const staleResolution = resolveCopy
documentValue.value = { version: 1, nodes: [{ kind: 'code', text: 'second\n', language: 'text' }] }
await nextTick()
assert.equal(status(), '')
assert.equal(button().disabled, false)
staleResolution()
await Promise.resolve(); await nextTick()
assert.equal(status(), '', 'Old copy completion does not change replaced document')
button().click(); await nextTick(); resolveCopy(); await Promise.resolve(); await nextTick()
assert.equal(status(), 'Copied')
assert.deepEqual(copied, ['first\n', 'second\n'])
// Same code, new document: old statuses still reset.
documentValue.value = { version: 1, nodes: [{ kind: 'code', text: 'second\n', language: 'text' }] }
await nextTick()
assert.equal(status(), '')
Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied') } } })
button().click(); await Promise.resolve(); await nextTick()
assert.match(status()!, /Could not copy/)
Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined })
button().click(); await Promise.resolve(); await nextTick()
assert.match(status()!, /Could not copy/)
Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>(resolve => { resolveCopy = resolve }) } })
button().click(); await nextTick()
app.unmount(); resolveCopy(); await Promise.resolve(); await nextTick()
assert.equal(container.textContent, '', 'Unmount cancels pending status updates')
console.info('Shipped Vue DOM: initial/repeated/pending/replaced/same-code-document/failure/unavailable/unmounted clipboard states passed')
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const { malformedDocument } = await import('./grammar.ts')
const rendered = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { document: malformedDocument }) }))
const hydrateContainer = window.document.createElement('div')
hydrateContainer.innerHTML = rendered
window.document.body.append(hydrateContainer)
const before = hydrateContainer.innerHTML
const hydrationMessages: string[] = []
const originalWarn = console.warn
const originalError = console.error
console.warn = (...args: unknown[]) => { hydrationMessages.push(args.join(' ')) }
console.error = (...args: unknown[]) => { hydrationMessages.push(args.join(' ')) }
const hydrated = createSSRApp({ render: () => h(MarkdownContent, { document: malformedDocument }) })
try {
  hydrated.mount(hydrateContainer)
  await nextTick()
  // Copy readiness intentionally changes disabled after mount; structure must not change.
  const withoutReadiness = (value: string) => value.replace(/ disabled(?:="")?/g, '')
  assert.equal(withoutReadiness(hydrateContainer.innerHTML), withoutReadiness(before))
  assert.deepEqual(hydrationMessages, [], 'SSR -> parsed DOM -> real Vue hydration has no mismatch')
  assert(!hydrateContainer.textContent?.includes('drop '))
}
finally { hydrated.unmount(); console.warn = originalWarn; console.error = originalError }
console.info('Malformed HTML model: shipped Vue SSR -> DOM -> hydrate passes without structural repairs or mismatch')
await window.happyDOM.close()
