import assert from 'node:assert/strict'
import { stringify, parse } from 'devalue'
import { parseRichTextDocument } from '@repo/nuxt-rich-text/runtime'

// Nuxt 4.5.2 renderPayloadJsonScript uses devalue.stringify then HTTP UTF-8.
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const raw = doc('unpaired \uD800 text')
const altered = parse(Buffer.from(stringify(raw), 'utf8').toString('utf8'))
assert.notDeepEqual(altered, raw, 'Pinned transport changes unvalidated lone surrogates')
assert.throws(() => parseRichTextDocument(raw), /Invalid rich-text document/)
for (const text of ['NUL\u0000text', '\uDC00']) assert.throws(() => parseRichTextDocument(doc(text)), /Invalid rich-text document/)
const canonical = parseRichTextDocument(doc('line1\r\nline2\rline3 😀 � café'))
const wire = parse(Buffer.from(stringify(canonical), 'utf8').toString('utf8'))
assert.deepEqual(wire, canonical)
assert.deepEqual(parseRichTextDocument(wire), canonical, 'SSR/client receive and revalidate the SAME canonical model')
assert.equal(wire.content[0].content[0].text, 'line1\nline2\nline3 😀 � café')
console.info('Canonical rich text survives actual Nuxt serializer/UTF-8 transport')
