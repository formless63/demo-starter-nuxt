import type { MarkdownDocument, MarkdownNode, MarkdownTag } from '@repo/nuxt-markdown-code/types'

const text = (value: string): MarkdownNode => ({ kind: 'text', text: value })
const element = (tag: MarkdownTag, ...children: MarkdownNode[]): MarkdownNode => ({ kind: 'element', tag, children })
const code: MarkdownNode = { kind: 'code', text: 'valid code\n', language: 'text' }
/** Deliberately invalid HTML nesting loaded from JSON, never executed markup. */
export const malformedDocument: MarkdownDocument = {
  version: 1,
  nodes: [
    element('p', text('before'), element('p', text('drop nested paragraph')), code, element('strong', element('ul', element('li', text('drop nested list')))), text('after')),
    element('a', text('outer'), element('em', element('a', text('drop nested anchor'))), text('tail')),
    element('h1', text('heading'), element('h2', text('drop nested heading'))),
    element('ul', text('drop list text'), element('p', text('drop list paragraph')), element('li', element('p', text('item')), element('li', text('drop orphan item')), element('ul', element('li', text('nested item'))), code)),
    element('table', text('drop foster text'), element('tr', element('td', text('drop direct row'))), element('thead', element('tr', element('th', text('Head')))), element('tbody', element('tr', element('td', text('Cell')))), element('thead', element('tr', element('th', text('drop late head'))))),
    element('li', text('drop root item')),
    element('tr', element('td', text('drop root row'))),
    element('td', text('drop root cell')),
    element('p', element('br', text('drop void child')), text('last')),
    element('hr', text('drop rule child')),
    text('drop carriage\rreturn'),
    text('drop nul\u0000text'),
    text('drop lone\uD800surrogate'),
    { kind: 'code', language: 'text', text: 'drop code\rvalue' },
    text('paired Unicode 😀 is preserved'),
  ],
}
