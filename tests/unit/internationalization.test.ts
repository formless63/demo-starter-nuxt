import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { createInternationalization, createPayload, validateConfig, type I18nConfig, type I18nPayload } from '../../packages/nuxt-internationalization/src/runtime/i18n'
import { useLocaleLoader } from '../../packages/nuxt-internationalization/src/runtime/locale'
const config: I18nConfig = { defaultLocale: 'en', fallbackLocale: 'en', timeZone: 'UTC', locales: {
  en: { direction: 'ltr', messages: { hello: 'Hello {name}', fallback: 'fallback', items_one: '{count} item', items_other: '{count} items', html: '<img src=x onerror=alert(1)>', nested: { value: 'nested' } } },
  de: { direction: 'ltr', messages: { hello: 'Hallo {name}', items_one: '{count} Eintrag', items_other: '{count} Einträge' } },
  ar: { direction: 'rtl', messages: { items_zero: 'zero', items_one: 'one', items_two: 'two', items_few: 'few', items_many: 'many', items_other: 'other' } },
} }
const payload = (locale = 'en') => createPayload(config, locale)
describe('internationalization contract', () => {
  it('uses isolated native composers, fallback and CLDR categories', () => {
    const a = createInternationalization(payload('en')), b = createInternationalization(payload('de'))
    expect(a.instance).not.toBe(b.instance)
    expect(a.text('hello', { name: 'Ada' })).toBe('Hello Ada')
    expect(b.text('hello', { name: 'Ada' })).toBe('Hallo Ada')
    expect(b.text('fallback')).toBe('fallback')
    expect(a.text('missing')).toBe('missing')
    expect(a.text('hello')).toBe('hello')
    expect(a.text('html')).toBe('<img src=x onerror=alert(1)>')
    expect(a.text('nested.value')).toBe('nested')
    expect([0, 1, 2].map(n => a.text('items', {}, n))).toEqual(['0 items', '1 item', '2 items'])
    expect([0, 1, 2].map(n => b.text('items', {}, n))).toEqual(['0 Einträge', '1 Eintrag', '2 Einträge'])
    const ar = createInternationalization(payload('ar'))
    expect([0, 1, 2, 3, 11, 100].map(n => ar.text('items', {}, n))).toEqual(['zero', 'one', 'two', 'few', 'many', 'other'])
  })
  it('validates descriptors without invoking getters or coercion', () => {
    let invoked = false
    const getter = Object.defineProperty({}, 'bad', { enumerable: true, get() { invoked = true; throw new Error('secret') } })
    const bads = [getter, Object.create({ inherited: 'bad' }), { constructor: 'bad' }, { bad: () => 'bad' }, { bad: ['bad'] }, { bad: '{broken' }, { bad: '@:hello' }, { bad: 'one|other' }, { bad: 'x'.repeat(8193) }, { bad: '\r\n'.repeat(4097) }, { [Symbol('bad')]: 'bad' }]
    for (const messages of bads) expect(() => validateConfig({ ...config, locales: { en: { direction: 'ltr', messages } } } as I18nConfig)).toThrow('Invalid internationalization configuration')
    expect(invoked).toBe(false)
    expect(() => validateConfig({ ...config, locales: { en: { direction: { toString() { invoked = true; return 'ltr' } }, messages: {} } } } as unknown as I18nConfig)).toThrow()
    expect(invoked).toBe(false)
    expect(() => createInternationalization(Object.defineProperty(payload(), 'locale', { get() { invoked = true; return 'en' } }))).toThrow()
    expect(invoked).toBe(false)
  })
  it('bounds depth, key count, bytes, formats and exact locale selection', () => {
    let nested: Record<string, unknown> = { leaf: 'x' }
    for (let i = 0; i < 8; i++) nested = { nested }
    for (const messages of [nested, Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`key${i}`, 'x'])), Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`key${i}`, 'x'.repeat(8192)]))]) expect(() => validateConfig({ ...config, locales: { en: { direction: 'ltr', messages } } } as I18nConfig)).toThrow()
    expect(payload('DE').locale).toBe('en')
    expect(() => validateConfig({ ...config, timeZone: 'invalid-zone' })).toThrow()
    const p = createPayload(config, 'de', [{ id: 'price', kind: 'number', value: 1234.5, preset: 'currency' }])
    expect(p.formatted.price).toBe(new Intl.NumberFormat('de', { style: 'currency', currency: 'EUR' }).format(1234.5))
    expect(() => createPayload(config, 'en', [Object.defineProperty({}, 'id', { enumerable: true, get() { throw new Error('private') } })] as never)).toThrow('Invalid internationalization configuration')
  })
  it('canonicalizes transport-sensitive text before rendering', () => {
    const p = createPayload({ ...config, locales: { en: { direction: 'ltr', messages: { text: 'a\r\nb\0\ud800😀' } } } }, 'en')
    expect(createInternationalization(p).text('text')).toBe('a\nb��😀')
  })
  it('contains diagnostic failures and interpolates long accepted messages', () => {
    const runtime = createInternationalization(payload(), () => { throw new Error('private') })
    expect(runtime.text('missing')).toBe('missing')
    const p = createPayload({ ...config, locales: { en: { direction: 'ltr', messages: { text: '{a}'.repeat(2000) } } } }, 'en')
    expect(createInternationalization(p).text('text', { a: 'z' })).toBe('z'.repeat(2000))
  })
  it('fences ignored aborts, failures, cancel and scope disposal', async () => {
    const pending: Array<{ locale: string, resolve: (value: I18nPayload) => void, reject: (error: Error) => void }> = []
    const scope = effectScope()
    const state = scope.run(() => useLocaleLoader(payload(), locale => new Promise((resolve, reject) => pending.push({ locale, resolve, reject }))))!
    const older = state.change('de'), newer = state.change('ar')
    pending[1]!.resolve(payload('ar')); expect(await newer).toBe(true)
    pending[0]!.resolve(payload('de')); expect(await older).toBe(false)
    expect(state.runtime.value.payload.locale).toBe('ar')
    const canceled = state.change('en'); state.cancel(); pending[2]!.resolve(payload()); expect(await canceled).toBe(false)
    const failed = state.change('de'); pending[3]!.reject(new Error('private')); expect(await failed).toBe(false); expect(state.status.value).toBe('error')
    const invalid = state.change('de'); pending[4]!.resolve({ ...payload('de'), timeZone: 'invalid' }); expect(await invalid).toBe(false)
    const mismatch = state.change('de'); pending[5]!.resolve(payload('en')); expect(await mismatch).toBe(false)
    const unmounted = state.change('en'); scope.stop(); pending[6]!.resolve(payload()); expect(await unmounted).toBe(false)
    expect(state.runtime.value.payload.locale).toBe('ar')
    expect(await state.change('de')).toBe(false)
  })
})
