// @vitest-environment node
import { parse, stringify } from 'devalue'
import { expect, test } from 'vitest'
import { parseRichTextDocument } from '../../packages/nuxt-rich-text/src/runtime/document'
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
test('server canonicalization precedes actual Nuxt devalue/UTF-8 transport', () => {
  const raw = doc('unpaired \uD800 text')
  expect(parse(Buffer.from(stringify(raw), 'utf8').toString('utf8'))).not.toEqual(raw)
  expect(() => parseRichTextDocument(raw)).toThrow('Invalid rich-text document')
  const canonical = parseRichTextDocument(doc('line1\r\nline2\rline3 😀 � café'))
  const wire = parse(Buffer.from(stringify(canonical), 'utf8').toString('utf8'))
  expect(wire).toEqual(canonical)
  expect(parseRichTextDocument(wire)).toEqual(canonical)
  expect(canonical.content[0]!.content![0]!.text).toBe('line1\nline2\nline3 😀 � café')
})
