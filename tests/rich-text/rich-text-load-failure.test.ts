import { expect, test, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import RichTextEditor from '../../packages/nuxt-rich-text/src/runtime/components/RichTextEditor.vue'
vi.mock('../../packages/nuxt-rich-text/src/runtime/components/RichTextClient.vue', () => { throw new Error('private loader failure') })
test('failed client load keeps safe content and exposes only a generic error', async () => {
 const host = document.createElement('div'); document.body.append(host)
 const app = createApp({ render: () => h(RichTextEditor, { documentKey: 'test', value: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Safe content' }] }] }, label: 'Document', onChange: () => {} }) })
 app.mount(host)
 try { await vi.waitFor(() => expect(host.textContent).toContain('Editor could not load.')); await nextTick(); expect(host.textContent).toContain('Safe content'); expect(host.textContent).not.toContain('private'); expect(host.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false') } finally { app.unmount(); host.remove() }
})
