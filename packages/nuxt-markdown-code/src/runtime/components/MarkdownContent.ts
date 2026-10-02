import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType, type VNodeChild } from 'vue'
import { markdownTags, normalizeMarkdownDocument, safeMarkdownHref, type MarkdownDocument, type MarkdownNode } from '../types'

const tags = new Set<string>(markdownTags)
const color = (value: string | undefined) => typeof value === 'string' && /^#[a-f\d]{6}([a-f\d]{2})?$/i.test(value) ? value : undefined
type CodeNode = Extract<MarkdownNode, { kind: 'code' }>
const CodeBlock = defineComponent({
  name: 'MarkdownCodeBlock',
  props: { node: { type: Object as PropType<CodeNode>, required: true }, revision: { type: Object, required: true } },
  setup(props) {
    const ready = ref(false)
    onMounted(() => { ready.value = true })
    const status = ref('')
    const pending = ref(false)
    let generation = 0
    watch([() => props.node.text, () => props.revision], () => { generation++; pending.value = false; status.value = '' }, { flush: 'sync' })
    onBeforeUnmount(() => { generation++ })
    const copy = async () => {
      if (pending.value) return
      pending.value = true
      status.value = 'Copying'
      const current = generation
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Unavailable')
        await navigator.clipboard.writeText(props.node.text)
        if (generation === current) status.value = 'Copied'
      }
      catch { if (generation === current) status.value = 'Could not copy. Select the code and copy it manually.' }
      finally { if (generation === current) pending.value = false }
    }
    return () => h('figure', { class: 'markdown-code-block' }, [
      h('figcaption', [h('span', props.node.language), h('button', { type: 'button', 'aria-label': `Copy ${props.node.language} code`, disabled: !ready.value || pending.value, onClick: copy }, 'Copy code'), h('output', { 'aria-live': 'polite' }, status.value)]),
      h('pre', { role: 'region', tabindex: 0, 'aria-label': `${props.node.language} code` }, [h('code', props.node.lines
        ? props.node.lines.map((line, index) => h('span', { key: index }, [index ? '\n' : '', ...line.map((span, column) => h('span', { key: column, style: { '--markdown-token-light': color(span.light), '--markdown-token-dark': color(span.dark) } }, span.text))]))
        : props.node.text)]),
    ])
  },
})
export const MarkdownContent = defineComponent({
  name: 'MarkdownContent',
  props: { document: { type: Object as PropType<MarkdownDocument>, required: true }, label: { type: String, default: 'Markdown content' } },
  setup(props) {
    return () => {
      const document = normalizeMarkdownDocument(props.document)
      let remaining = 4096
      const render = (node: MarkdownNode, key: string, depth = 0): VNodeChild => {
        if (!node || --remaining < 0 || depth > 24) return null
        if (node.kind === 'text') return typeof node.text === 'string' ? node.text : ''
        if (node.kind === 'code') return h(CodeBlock, { node, key, revision: props.document })
        if (node.kind !== 'element' || !tags.has(node.tag) || !Array.isArray(node.children)) return null
        const children = node.children.slice(0, remaining).map((child, i) => render(child, `${key}-${i}`, depth + 1))
        if (node.tag === 'a') return h('a', { key, href: safeMarkdownHref(typeof node.href === 'string' ? node.href : ''), rel: 'nofollow noreferrer' }, children)
        if (node.tag === 'br' || node.tag === 'hr') return h(node.tag, { key })
        return h(node.tag, { key, ...(node.tag === 'ol' && Number.isSafeInteger(node.start) && node.start! >= 0 && node.start! <= 999999999 ? { start: node.start } : {}) }, children)
      }
      return h('section', { class: 'markdown-content', 'aria-label': props.label }, document.nodes.map((node, i) => render(node, `node-${i}`)))
    }
  },
})
