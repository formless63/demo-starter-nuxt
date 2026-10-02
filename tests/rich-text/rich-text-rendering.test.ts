import { parseFragment } from 'parse5'
import { parseRichTextDocument } from '../../packages/nuxt-rich-text/src/runtime/document'
import { expect, test } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import RichTextContent from '../../packages/nuxt-rich-text/src/runtime/components/RichTextContent.vue'
import RichTextEditor from '../../packages/nuxt-rich-text/src/runtime/components/RichTextEditor.vue'
import { allFeatures } from './rich-text-fixtures'
test('safe SSR preserves canonical whitespace and Unicode without loading editable DOM', async () => {
 const markup = await renderToString(createSSRApp({ render: () => h(RichTextContent, { value: allFeatures, label: 'Preview' }) }))
 expect(markup).toContain('white-space:pre-wrap'); expect(markup).not.toContain('contenteditable')
 const doc = new DOMParser().parseFromString(markup, 'text/html')
 expect(doc.querySelector('h2')).not.toBeNull(); expect(doc.querySelector('blockquote')).not.toBeNull(); expect(doc.querySelector('pre code')).not.toBeNull()
 const loading = await renderToString(createSSRApp({ render: () => h(RichTextEditor, { documentKey: 'test', value: allFeatures, label: 'Document', onChange: () => {} }) }))
 const bytes = new TextEncoder().encode(loading)
 expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toContain('Loading editor…')
 expect(loading).not.toContain('contenteditable'); expect(loading).not.toContain('�')
})

test('canonical document survives real HTML5 parsing after UTF-8 transport', async () => {
 const value = parseRichTextDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'line1\r\nline2\rline3 😀 � café' }] }] })
 const html = await renderToString(createSSRApp({ render: () => h(RichTextContent, { value }) }))
 const wire = new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(html))
 const parsed = parseFragment(wire)
 function texts(node: unknown): string {
  const item = node as { nodeName: string; value?: string; childNodes?: unknown[] }
  return item.nodeName === '#text' ? item.value ?? '' : (item.childNodes ?? []).map(texts).join('')
 }
 expect(texts(parsed)).toBe(value.content[0]!.content![0]!.text)
 expect(texts(parsed)).toBe('line1\nline2\nline3 😀 � café')
})

test.each(['', undefined])('editor fails closed without a nonempty document key: %s', async (documentKey) => {
 const html = await renderToString(createSSRApp({ render: () => h(RichTextEditor, { documentKey: documentKey as string, value: allFeatures, label: 'Document', onChange: () => {} }) }))
 expect(html).toContain('Invalid rich-text document.'); expect(html).not.toContain('Loading editor'); expect(html).not.toContain('contenteditable')
})
