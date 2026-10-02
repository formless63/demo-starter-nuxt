<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, useId } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { AllSelection, EditorState, Selection } from '@tiptap/pm/state'
import { isSafeRichTextLink, normalizeRichTextText, richTextLimits, type RichTextDocument } from '../document'
import { bounds, documentFromEditor } from '../editor'
const props = defineProps<{ value: RichTextDocument; label: string; onChange: (value: RichTextDocument) => void }>()
const editor = shallowRef<Editor>()
const revision = ref(0), link = ref(''), linkError = ref(false)
const linkId = useId()
let alive = true
function reconcile() {
  const e = editor.value
  if (!alive || !e) return
  if (JSON.stringify(documentFromEditor(e.getJSON())) !== JSON.stringify(props.value)) {
    const doc = e.schema.nodeFromJSON(props.value)
    doc.check()
    const state = EditorState.create({ schema: e.schema, doc, plugins: e.state.plugins })
    // Vue's adapter caches state on beforeTransaction; update both adapter and view.
    e.emit('beforeTransaction', { editor: e, transaction: state.tr, nextState: state })
    e.view.updateState(state)
    revision.value++
  }
}
onMounted(() => {
  editor.value = new Editor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, horizontalRule: false, underline: false, trailingNode: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: isSafeRichTextLink, HTMLAttributes: { target: null, rel: 'noopener noreferrer nofollow' } } }), bounds],
    content: props.value, injectCSS: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': props.label, 'aria-multiline': 'true', style: 'white-space: pre-wrap; overflow-wrap: anywhere; min-height: 10rem;' },
      handlePaste(view, event) {
        event.preventDefault()
        const raw = event.clipboardData?.getData('text/plain') ?? ''
        if (!raw.length || raw.length > richTextLimits.characters) return true
        let text: string
        try { text = normalizeRichTextText(raw) } catch { return true }
        view.dispatch(view.state.tr.insertText(text))
        return true
      },
      handleDrop(_view, event) { event.preventDefault(); return true },
    },
    onTransaction() { revision.value++ },
    onUpdate({ editor: updated }) {
      try { props.onChange(documentFromEditor(updated.getJSON())) }
      finally { void nextTick(reconcile) }
    },
  })
})
watch(() => props.value, reconcile, { flush: 'post', deep: true })
watch(() => props.label, label => { const e = editor.value; if (e) e.setOptions({ editorProps: { ...e.options.editorProps, attributes: { ...e.options.editorProps.attributes, 'aria-label': label } } }) })
onBeforeUnmount(() => { alive = false; editor.value?.destroy(); editor.value = undefined })
const controls = [
  { name: 'Bold', node: 'bold', run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { name: 'Italic', node: 'italic', run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { name: 'Strike', node: 'strike', run: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { name: 'Inline code', node: 'code', run: (e: Editor) => e.chain().focus().toggleCode().run() },
  { name: 'Heading', node: 'heading', run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { name: 'Bullet list', node: 'bulletList', run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { name: 'Ordered list', node: 'orderedList', run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { name: 'Quote', node: 'blockquote', run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { name: 'Code block', node: 'codeBlock', run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
]
const state = computed(() => { void revision.value; const e = editor.value; return { active: controls.map(c => e?.isActive(c.node) ?? false), undo: e?.can().undo() ?? false, redo: e?.can().redo() ?? false } })
function run(action: (e: Editor) => unknown) {
  const e = editor.value
  if (!e) return
  if (e.state.selection instanceof AllSelection) e.commands.setTextSelection({ from: Selection.atStart(e.state.doc).from, to: Selection.atEnd(e.state.doc).to })
  action(e)
}
function applyLink() { if (!isSafeRichTextLink(link.value)) { linkError.value = true; return }; run(e => e.chain().focus().extendMarkRange('link').setLink({ href: link.value }).run()); linkError.value = false }
</script>
<template>
  <div v-if="editor">
    <fieldset :aria-label="`${label} formatting`">
      <button v-for="(control, index) in controls" :key="control.name" type="button" :aria-pressed="state.active[index]" @mousedown.prevent @click="run(control.run)">{{ control.name }}</button>
      <button type="button" :disabled="!state.undo" @click="run(e => e.chain().focus().undo().run())">Undo</button>
      <button type="button" :disabled="!state.redo" @click="run(e => e.chain().focus().redo().run())">Redo</button>
    </fieldset>
    <label :for="linkId">Link URL</label><input :id="linkId" v-model="link" type="url" :aria-invalid="linkError" @input="linkError = false">
    <button type="button" @click="applyLink">Apply link</button><button type="button" @click="run(e => e.chain().focus().extendMarkRange('link').unsetLink().run())">Remove link</button>
    <p v-if="linkError" role="alert">Enter an absolute HTTP, HTTPS or mailto URL without credentials or whitespace.</p>
    <EditorContent :editor="editor" />
  </div>
  <output v-else>Loading editor…</output>
</template>
