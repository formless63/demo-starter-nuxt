import { strict as assert } from 'node:assert'
import { unlink } from 'node:fs/promises'
import { Window } from 'happy-dom'
const window = new Window()
for (const name of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Text', 'Comment']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : (window as unknown as Record<string, unknown>)[name] })
const { parse, compileScript } = await import('@vue/compiler-sfc')
const sourceURL = new URL('./runtime/components/InternationalizationProvider.vue', import.meta.resolve('@repo/nuxt-internationalization'))
const source = await Bun.file(sourceURL).text()
const { descriptor } = parse(source)
let code = compileScript(descriptor, { id: 'fixture', inlineTemplate: true }).content
code = code.replaceAll("from '../i18n'", `from '${new URL('../i18n.js', sourceURL).href}'`).replaceAll("from '../locale'", `from '${new URL('../locale.js', sourceURL).href}'`)
code = code.replaceAll('from "../i18n"', `from '${new URL('../i18n.js', sourceURL).href}'`).replaceAll('from "../locale"', `from '${new URL('../locale.js', sourceURL).href}'`)
const compiled = new URL('./provider-compiled.mjs', import.meta.url)
await Bun.write(compiled, new Bun.Transpiler({ loader: 'ts' }).transformSync(code))
try {
  const Provider = (await import(compiled.href)).default
  const { createApp, h, shallowRef, nextTick } = await import('vue')
  const { createPayload } = await import('@repo/nuxt-internationalization/runtime')
  const config = { defaultLocale: 'en', fallbackLocale: 'en', timeZone: 'UTC', locales: { en: { direction: 'ltr' as const, messages: { text: 'Hello' } }, ar: { direction: 'rtl' as const, messages: { text: 'مرحبا' } } } }
  const current = shallowRef(createPayload(config, 'en'))
  const show = shallowRef(true)
  const errors: unknown[] = []
  const app = createApp({ render: () => h('div', [show.value ? h(Provider, { payload: current.value }, { default: ({ i18n }: { i18n: { text: (key: string) => string } }) => h('p', i18n.text('text')) }) : null, h(Provider, { payload: createPayload(config, 'en') }, { default: ({ i18n }: { i18n: { text: (key: string) => string } }) => h('p', i18n.text('text')) })]) })
  app.config.errorHandler = error => errors.push(error)
  const mount = document.createElement('div'); document.body.appendChild(mount); app.mount(mount)
  assert.deepEqual([...mount.querySelectorAll('p')].map(x => x.textContent), ['Hello', 'Hello'])
  current.value = createPayload(config, 'ar'); await nextTick()
  assert.deepEqual([...mount.querySelectorAll('p')].map(x => x.textContent), ['مرحبا', 'Hello'])
  assert.equal(mount.querySelector('section')!.dir, 'rtl')
  show.value = false; await nextTick(); assert.equal(mount.querySelectorAll('section').length, 1)
  show.value = true; await nextTick(); assert.deepEqual([...mount.querySelectorAll('p')].map(x => x.textContent), ['مرحبا', 'Hello'])
  app.unmount(); assert.equal(mount.innerHTML, ''); assert.deepEqual(errors, [])
} finally { await unlink(compiled) }
