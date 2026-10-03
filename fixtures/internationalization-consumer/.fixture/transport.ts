import { strict as assert } from 'node:assert'
import { stringify, parse } from 'devalue'
import { createPayload, createInternationalization } from '@repo/nuxt-internationalization/runtime'
const payload = createPayload({ defaultLocale: 'en', fallbackLocale: 'en', timeZone: 'UTC', locales: { en: { direction: 'ltr', messages: { text: 'a\r\nb\0\ud800 c😀' } } } }, 'en')
const transported = parse(new TextDecoder().decode(new TextEncoder().encode(stringify(payload))))
assert.deepEqual(transported, payload)
assert.equal(createInternationalization(transported).text('text'), 'a\nb�� c😀')
