// @vitest-environment node
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from '../../packages/nuxt-markdown-code/src/runtime/components/MarkdownContent'
import { MarkdownLimitError, markdownLimits, parseMarkdown } from '../../packages/nuxt-markdown-code/src/runtime/server/index'
import { safeMarkdownHref } from '../../packages/nuxt-markdown-code/src/runtime/types'
import type { MarkdownDocument } from '../../packages/nuxt-markdown-code/src/runtime/types'

describe('Markdown shipped contract', () => {
  it('bounds sparse table allocation and inline code nodes', async () => {
    const sparse = `|${Array(50).fill('x').join('|')}|\n|${Array(50).fill('-').join('|')}|\n${'|x|\n'.repeat(30)}`
    await expect(parseMarkdown(sparse)).rejects.toMatchObject({ name: 'MarkdownLimitError', allocatedTokens: markdownLimits.tokens })
    await expect(parseMarkdown('`x` '.repeat(2000))).rejects.toBeInstanceOf(MarkdownLimitError)
  })
  it('preserves ordered starts, escapes HTML and provides real dual-theme tokens', async () => {
    const document = await parseMarkdown('3. Third\n4. Fourth\n\n<script>bad()</script>\n\n```ts\nconst x = 1\n```')
    const html = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { document }) }))
    expect(html).toContain('<ol start="3">')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('--markdown-token-light:#')
    expect(html).toContain('Copy typescript code')
  })
  it('rechecks deserialized tags, URLs and token colors without spreading attributes', async () => {
    const document = { version: 1, nodes: [
      { kind: 'element', tag: 'script', children: [] },
      { kind: 'element', tag: 'a', href: 'javascript:alert(1)', onClick: 'alert(1)', children: [{ kind: 'text', text: 'link' }] },
      { kind: 'code', language: 'text', text: 'safe', lines: [[{ text: '<unsafe>', light: 'url(https://tracker.invalid)', dark: '#fff;background:red' }]] },
    ] } as unknown as MarkdownDocument
    const html = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { document }) }))
    expect(html).toContain('<code>safe</code>')
    for (const marker of ['<script', 'javascript:', 'onclick', 'tracker.invalid', 'background:red']) expect(html).not.toContain(marker)
    expect(safeMarkdownHref('https://user:secret@example.com')).toBeUndefined()
  })
  it('drops invalid HTML nesting before SSR', async () => {
    const document = { version: 1, nodes: [{ kind: 'element', tag: 'p', children: [{ kind: 'element', tag: 'p', children: [{ kind: 'text', text: 'drop nested' }] }, { kind: 'text', text: 'kept' }] }] } as MarkdownDocument
    const html = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { document }) }))
    expect(html).toContain('<p>kept</p>')
    expect(html).not.toContain('drop nested')
  })

})
