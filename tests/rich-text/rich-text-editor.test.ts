import { describe, expect, it, vi } from 'vitest'
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
  let emissions = 0
  const value = ref(doc('Initial')), accept = ref(true), visible = ref(true), documentKey = ref(0)
  const app = createApp({ setup: () => () => visible.value ? h(RichTextClient, { key: documentKey.value, value: value.value, label: 'Document', onChange: (next: RichTextDocument) => { emissions++; if (accept.value) value.value = structuredClone(next) } }) : null })
  app.mount(host); await flush()
  const input = () => host.querySelector<HTMLElement>('[contenteditable]')!
  // Tiptap attaches its real editor to the contenteditable DOM node.
  const editor = () => (input() as HTMLElement & { editor: Editor }).editor
  try {
   expect(input().style.whiteSpace).toBe('pre-wrap')
   value.value = doc('PRIVATE old record'); await flush(); editor().commands.setContent(doc('Public')); await flush(); expect(editor().can().undo()).toBe(true); const retired = editor(); const retiredCallback = retired.options.onUpdate; const beforeRetirement = emissions; const retiredTransaction = retired.state.tr; value.value = doc('Public'); documentKey.value++; await flush(); expect(retired.isDestroyed).toBe(true); expect(() => retired.commands.insertContent('PRIVATE late')).toThrow(); retiredCallback({ editor: retired, transaction: retiredTransaction, appendedTransactions: [] }); await flush(); expect(emissions).toBe(beforeRetirement); expect(JSON.stringify(value.value)).not.toContain('PRIVATE'); editor().commands.undo(); editor().commands.redo(); await flush(); expect(input().textContent).toBe('Public'); expect(editor().can().undo()).toBe(false); expect(editor().can().redo()).toBe(false)
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

it('toolbar focus cannot reclaim a URL input on a later animation frame', async () => {
 const host = document.createElement('div'); document.body.append(host)
 const value = ref(doc('Edited document'))
 const app = createApp({ setup: () => () => h(RichTextClient, { value: value.value, label: 'Document', onChange: (next: RichTextDocument) => { value.value = structuredClone(next) } }) })
 app.mount(host); await flush()
 const content = host.querySelector<HTMLElement>('[contenteditable]')!
 const editor = (content as HTMLElement & { editor: Editor }).editor
 const callbacks: FrameRequestCallback[] = []
 const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length })
 const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!
 try {
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
  editor.commands.toggleBold(); await flush()
  // Real pointer activation focuses Undo/Redo before their click handler.
  button('Undo').focus(); button('Undo').click(); await flush()
  button('Redo').focus(); button('Redo').click(); await flush()
  const url = host.querySelector<HTMLInputElement>('input[type="url"]')!
  url.focus(); url.value = 'javascript:alert(1)'; url.dispatchEvent(new Event('input', { bubbles: true })); await flush()
  // Deliver every deferred frame only AFTER the user moved to the link field.
  for (const callback of callbacks.splice(0)) callback(0)
  await flush()
  expect(document.activeElement).toBe(url)
  expect(content.textContent).toBe('Edited document')
  expect(url.value).toBe('javascript:alert(1)')
  button('Apply link').focus(); button('Apply link').click(); await flush()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('absolute HTTP')
  expect(content.querySelector('a')).toBeNull()
  expect(content.textContent).toBe('Edited document')
  url.focus(); url.value = 'https://example.test/path'; url.dispatchEvent(new Event('input', { bubbles: true })); await flush()
  button('Apply link').focus(); button('Apply link').click(); await flush()
  expect(content.querySelector('a')?.getAttribute('href')).toBe('https://example.test/path')
  expect(content.textContent).toBe('Edited document')
  // An explicit link action may focus the editor now, never later after the
  // user has already moved elsewhere.
  url.focus()
  for (const callback of callbacks.splice(0)) callback(0)
  await flush()
  expect(document.activeElement).toBe(url)
 } finally { frame.mockRestore(); app.unmount(); host.remove() }
})
