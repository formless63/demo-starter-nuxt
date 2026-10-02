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
 const loading = await renderToString(createSSRApp({ render: () => h(RichTextEditor, { value: allFeatures, label: 'Document', onChange: () => {} }) }))
 const bytes = new TextEncoder().encode(loading)
 expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toContain('Loading editor…')
 expect(loading).not.toContain('contenteditable'); expect(loading).not.toContain('�')
})
