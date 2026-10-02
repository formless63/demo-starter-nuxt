import { h, type VNodeChild } from 'vue'
import type { RichTextNode } from './document'
export function renderRichTextNode(node: RichTextNode): VNodeChild {
  if (node.type === 'text') {
    let text: VNodeChild = node.text
    for (const mark of [...(node.marks ?? [])].reverse()) text = mark.type === 'link'
      ? h('a', { href: mark.attrs.href, rel: 'noopener noreferrer nofollow' }, [text])
      : h(({ bold: 'strong', italic: 'em', strike: 's', code: 'code' } as const)[mark.type], [text])
    return text
  }
  const children = node.content?.map(renderRichTextNode)
  if (node.type === 'codeBlock') return h('pre', [h('code', children)])
  const tag = node.type === 'heading' ? `h${node.attrs?.level}` : ({ doc: 'div', paragraph: 'p', blockquote: 'blockquote', bulletList: 'ul', orderedList: 'ol', listItem: 'li', hardBreak: 'br' } as Record<string, string>)[node.type]!
  return h(tag, node.type === 'orderedList' ? { start: node.attrs?.start } : {}, children)
}
