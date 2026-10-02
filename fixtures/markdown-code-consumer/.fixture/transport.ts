import assert from 'node:assert/strict'
import { stringify, parse } from 'devalue'
import { normalizeMarkdownDocument, parseMarkdown } from '@repo/nuxt-markdown-code/server'
import { malformedDocument } from './grammar.ts'

// Nuxt4.5.2 renderPayloadJsonScript uses devalue.stringify then HTTP UTF-8.
// This reproduces the actual loss without treating legitimate U+FFFD as invalid.
const raw = { text: 'drop lone\uD800surrogate' }
const encoded = stringify(raw)
assert(encoded.includes('\uD800'), 'Pinned serializer contains raw lone surrogate')
const rawWire = parse(Buffer.from(encoded, 'utf8').toString('utf8'))
assert.equal(rawWire.text, 'drop lone�surrogate')
assert.notEqual(rawWire.text, raw.text)
const canonical = normalizeMarkdownDocument(malformedDocument)
const wire = parse(Buffer.from(stringify(canonical), 'utf8').toString('utf8'))
assert.deepEqual(wire, canonical)
assert.deepEqual(normalizeMarkdownDocument(wire), canonical, 'SSR and client revalidation share the exact canonical model')
assert(JSON.stringify(wire).includes('replacement character � is legitimate'))
assert(!JSON.stringify(wire).includes('drop '))
const parsed = await parseMarkdown('Safe � and 😀\n\ninvalid \uD800 text\n\n```ts\nconst emoji = "😀"\n```')
assert.deepEqual(parse(Buffer.from(stringify(parsed), 'utf8').toString('utf8')), parsed, 'Parser output is already canonical before transport')
console.info('Actual Nuxt devalue/UTF-8 loss reproduced; pre-transport canonical model roundtrips and retains legitimate U+FFFD/Unicode')
