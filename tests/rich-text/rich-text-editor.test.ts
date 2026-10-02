import { describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import RichTextClient from '../../packages/nuxt-rich-text/src/runtime/components/RichTextClient.vue'
import { allFeatures } from './rich-text-fixtures'
import { bounds, documentFromEditor } from '../../packages/nuxt-rich-text/src/runtime/editor'
import { richTextLimits, type RichTextDocument } from '../../packages/nuxt-rich-text/src/runtime/document'
const doc = (text: string): RichTextDocument => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const flush = async () => { await nextTick(); await nextTick(); await nextTick() }
describe('real Vue Tiptap editor lifecycle', () => {
 it('synchronously accepts or rejects controlled changes and resets replacement/rejection history', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const value = ref(doc('Initial')), accept = ref(true), visible = ref(true)
  const app = createApp({ setup: () => () => visible.value ? h(RichTextClient, { value: value.value, label: 'Document', onChange: (next: RichTextDocument) => { if (accept.value) value.value = next } }) : null })
  app.mount(host); await flush()
  const input = () => host.querySelector<HTMLElement>('[contenteditable]')!
  // Tiptap attaches its real editor to the contenteditable DOM node.
  const editor = () => (input() as HTMLElement & { editor: Editor }).editor
  try {
   expect(input().style.whiteSpace).toBe('pre-wrap')
   editor().commands.insertContent('Accepted '); await flush(); expect(JSON.stringify(value.value)).toContain('Accepted')
   accept.value = false; editor().commands.insertContent('PRIVATE'); await flush(); expect(input().textContent).not.toContain('PRIVATE'); expect(editor().can().undo()).toBe(false); expect(editor().can().redo()).toBe(false); editor().commands.undo(); editor().commands.redo(); await flush(); expect(input().textContent).not.toContain('PRIVATE')
   accept.value = true; value.value = doc('Replacement'); await flush(); expect(input().textContent).toBe('Replacement'); expect(editor().can().undo()).toBe(false); expect(editor().can().redo()).toBe(false); editor().commands.undo(); editor().commands.redo(); await flush(); expect(input().textContent).toBe('Replacement')
   editor().commands.selectAll(); const quote = [...host.querySelectorAll('button')].find(b => b.textContent === 'Quote')!; quote.click(); await flush(); expect(input().querySelector('blockquote')).not.toBeNull(); quote.click(); await flush(); expect(input().querySelector('blockquote')).toBeNull()
   visible.value = false; await flush(); visible.value = true; await flush(); expect(input().textContent).toBe('Replacement'); expect(editor().can().undo()).toBe(false)
  } finally { app.unmount(); host.remove() }
 })
 it('rejects oversized transactions before document mutation', () => {
  const editor = new Editor({ extensions: [StarterKit.configure({ trailingNode: false }), bounds], content: doc('safe'), injectCSS: false })
  try { editor.commands.insertContent('x'.repeat(richTextLimits.characters + 1)); expect(documentFromEditor(editor.getJSON())).toEqual(doc('safe')) } finally { editor.destroy() }
 })
})

it('real Tiptap preserves the complete canonical document schema', () => {
 const editor = new Editor({ extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, horizontalRule: false, underline: false, trailingNode: false })], content: allFeatures, injectCSS: false })
 try { expect(documentFromEditor(editor.getJSON())).toEqual(allFeatures) } finally { editor.destroy() }
})
