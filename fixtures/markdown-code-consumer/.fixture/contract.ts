import assert from 'node:assert/strict';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parseMarkdown, MarkdownLimitError, markdownLimits } from '@repo/nuxt-markdown-code/server';
import { MarkdownContent } from '@repo/nuxt-markdown-code/components';
import { normalizeMarkdownDocument, safeMarkdownHref } from '@repo/nuxt-markdown-code/types';
import type { MarkdownDocument, MarkdownNode } from '@repo/nuxt-markdown-code/types';

const render = async (source:string) => { const document = await parseMarkdown(source); return renderToString(createSSRApp({render: () => h(MarkdownContent, {document})})); };
const output = await render('# Title\n\n**bold** and *emphasis* and ~~deleted~~ and `inline`\n\n> quote\n\n3. Third\n4. Fourth\n\n|Name|Value|\n|---|---|\n|Ada|42|\n');
for (const marker of ['<h1>Title</h1>','<strong>bold</strong>','<em>emphasis</em>','<s>deleted</s>','<code>inline</code>','<blockquote>','<ol start="3">','<th>Name</th>']) assert.ok(output.includes(marker),marker);
for (const href of ['javascript:alert(1)','data:text/html,x','vbscript:x','//example.com','/\\example.com','https://user:password@example.com','http://example.com','./local','../local','mailto:a@example.com?subject=x','https://example.com\u0000','https:example.com','mailto:a%0ab@example.com']) assert.equal(safeMarkdownHref(href),undefined,href);
for (const href of ['https://example.com/path','/local','/x?q=yes','#section','mailto:a@example.com']) assert.ok(safeMarkdownHref(href),href);
assert.ok((await render('0. First\n1. Second')).includes('<ol start="0">'));
assert.ok((await render('1. First\n2. Second')).includes('<ol start="1">'));
const sparseTable = '|'+Array(50).fill('x').join('|')+'|\n|'+Array(50).fill('-').join('|')+'|\n'+('|x|\n').repeat(30);
await assert.rejects(() => parseMarkdown(sparseTable), (error:unknown) => error instanceof MarkdownLimitError && error.allocatedTokens === markdownLimits.tokens);
const hostile = await render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [encoded](jav&#x61;script:alert(1)) [protocol](//evil.test)\n\n![safe alt](https://tracker.invalid/a.png)\n\n[ok](https://example.com)');
assert.ok(hostile.includes('&lt;script&gt;'));
assert.ok(hostile.includes('safe alt'));
assert.ok(hostile.includes('href="https://example.com/"'));
for (const marker of ['<script','<img','href="javascript','href="//','onerror="']) assert.ok(!hostile.includes(marker),marker);
const firstCode = (nodes:MarkdownNode[]) => nodes.find(node => node.kind === 'code');
const document = await parseMarkdown('```ts ignored metadata\nconst greeting = "<script>"\n```\n');
const code = firstCode(document.nodes);
assert.equal(code?.kind,'code');
if (code?.kind !== 'code') throw new Error('Missing code');
assert.equal(code.text,'const greeting = "<script>"\n');
assert.ok(code.lines?.some(line => line.some(token => token.light && token.dark)),'actual Shiki highlighting');
assert.equal(code.lines?.map(line => line.map(token => token.text).join('')).join('\n'),code.text,'exact original code including trailing newline');
const html = await renderToString(createSSRApp({render: () => h(MarkdownContent, {document})}));
assert.match(html,/Copy typescript code/);
assert.match(html,/&lt;script&gt;/);
assert.match(html,/<output aria-live="polite"/);
assert.match(html,/tabindex="0"/);
const unknown = firstCode((await parseMarkdown('```not-a-language\n<script>plain</script>\n```')).nodes);
assert.ok(unknown?.kind === 'code' && unknown.language === 'text' && unknown.lines === undefined);
const windowsCode = firstCode((await parseMarkdown('```ts\r\nconst value = 1\r\n```')).nodes);
assert.ok(windowsCode?.kind === 'code' && windowsCode.text === 'const value = 1\n');
const longLine = firstCode((await parseMarkdown(`\`\`\`ts\n${'x'.repeat(markdownLimits.highlightLineCharacters+1)}\n\`\`\``)).nodes);
assert.ok(longLine?.kind === 'code' && longLine.lines === undefined);
await assert.rejects(() => parseMarkdown('x'.repeat(markdownLimits.inputBytes+1)),MarkdownLimitError);
await assert.rejects(() => parseMarkdown('😀'.repeat(markdownLimits.inputBytes/3)),MarkdownLimitError);
await assert.rejects(() => parseMarkdown('a\n\n'.repeat(2049)),MarkdownLimitError);
await assert.rejects(() => parseMarkdown('`x` '.repeat(2000)),MarkdownLimitError);
await assert.rejects(() => parseMarkdown('```\nx\n```\n\n'.repeat(33)),MarkdownLimitError);
await assert.rejects(() => parseMarkdown(`\`\`\`\n${'x'.repeat(markdownLimits.codeCharacters+1)}\n\`\`\``),MarkdownLimitError);
assert.ok(JSON.stringify(await parseMarkdown('> '.repeat(100)+'nested')).length < 65536);
assert.equal(await render(''),'<section class="markdown-content" aria-label="Markdown content"></section>');
console.info('Markdown shipped parser/Vue renderer: syntax, exact Shiki token roundtrip, SSR escaping, URL policy, alt-only images, plaintext fallback and all resource limits passed');

// A forged/deserialized model still cannot choose an arbitrary element, URL or CSS value.
const forged = {version:1,nodes:[
 {kind:'element',tag:'script',children:[{kind:'text',text:'alert(1)'}]},
 {kind:'element',tag:'img',src:'https://tracker.invalid',onError:'alert(1)',children:[]},
 {kind:'element',tag:'a',href:'javascript:alert(1)',onClick:'alert(1)',style:{backgroundImage:'url(https://tracker.invalid)'},children:[{kind:'text',text:'unsafe target'}]},
 {kind:'code',language:'text',text:'literal',lines:[[{text:'<script>literal</script>',light:'url(https://tracker.invalid)',dark:'#fff;background:red'}]]},
]} as unknown as MarkdownDocument;
const forgedHtml = await renderToString(createSSRApp({render: () => h(MarkdownContent, {document:forged})}));
assert.ok(forgedHtml.includes('<code>literal</code>'));
for (const marker of ['<script','<img','javascript:','tracker.invalid','background:red','onclick=','onerror=']) assert.ok(!forgedHtml.includes(marker),marker);
console.info('Markdown renderer independently rejects forged tags, hrefs, attributes and highlighted CSS values');

const codeBlocks = async (source:string) => (await parseMarkdown(source)).nodes.filter((node):node is Extract<MarkdownNode,{kind:'code'}> => node.kind === 'code');
const fence = (text:string) => '```ts\n'+text+'```\n\n';
assert.equal((await codeBlocks(fence(('x'.repeat(127)+'\n').repeat(65))))[0].lines,undefined,'per-block highlight budget');
assert.equal((await codeBlocks(fence('x\n'.repeat(128))))[0].lines,undefined,'highlight line budget');
const comments = ('//'+ 'x'.repeat(117)+'\n').repeat(50);
const aggregate = await codeBlocks(fence(comments).repeat(3));
assert.ok(aggregate[0].lines && aggregate[1].lines && !aggregate[2].lines,'aggregate highlight budget');
const operators = ('x+'.repeat(255)+'x\n').repeat(12);
const manyTokens = await codeBlocks(fence(operators).repeat(2));
assert.ok(manyTokens[0].lines && !manyTokens[1].lines,'aggregate span budget');
const maxDepth = (nodes:MarkdownNode[],depth=0):number => Math.max(depth,...nodes.map(node=>node.kind === 'element' ? maxDepth(node.children,depth+1) : depth));
assert.ok(maxDepth((await parseMarkdown('> '.repeat(100)+'nested')).nodes) <= markdownLimits.depth,'bounded rendered nesting');
console.info('Markdown per-block/aggregate highlight characters, line length/count, span and nesting budgets passed');


for (const value of [null, undefined, 1, [], {}, { version: 1, nodes: null }, { version: 1, nodes: [null, { kind: 'code', text: null }] }]) {
  const html = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { document: value as MarkdownDocument }) }))
  assert(html.length < 200, 'Malformed documents render safely')
}
for (const lines of [null, {}, [null], [[null]], [[{ text: {} }]], [[{ text: 'x'.repeat(65537) }]], Array(129).fill([]), [Array(8193).fill({ text: '' })], [[{ text: 'shown', light: '#ff0000' }]]]) {
  const document = { version: 1 as const, nodes: [{ kind: 'code', text: 'copied', language: 'javascript', lines }] } as unknown as MarkdownDocument
  const html = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { document }) }))
  assert(html.includes('<code>copied</code>'), 'Malformed, oversized or mismatched highlights use exact plaintext')
  assert(html.length < 1000)
}
for (const text of [null, {}, 'x'.repeat(32769)]) {
  const document = { version: 1, nodes: [{ kind: 'code', text, language: {} }] } as unknown as MarkdownDocument
  const html = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { document }) }))
  assert(!html.includes('<figure'), 'Malformed or over-budget code is rejected')
}
console.info('Untrusted renderer models: malformed/null documents, code/highlight shapes, bounded dimensions, and display/copy equality passed')

const flat = normalizeMarkdownDocument({ version: 1, nodes: Array(4097).fill({ kind: 'text', text: 'x' }) })
assert.equal(flat.nodes.length, 4096)
assert.equal(normalizeMarkdownDocument({ version: 1, nodes: [{ kind: 'text', text: '😀'.repeat(20000) }] }).nodes.length, 0)
const blocks = normalizeMarkdownDocument({ version: 1, nodes: Array(33).fill({ kind: 'code', language: 'text', text: 'x' }) })
assert.equal(blocks.nodes.length, 32)
const oversizedCode = normalizeMarkdownDocument({ version: 1, nodes: Array(5).fill({ kind: 'code', language: 'text', text: 'x'.repeat(8192) }) })
assert.equal(oversizedCode.nodes.length, 4)

const cycle: Record<string, unknown> = { kind: 'element', tag: 'blockquote' }
cycle.children = [cycle]
const boundedCycle = normalizeMarkdownDocument({ version: 1, nodes: [cycle] })
assert.equal(maxDepth(boundedCycle.nodes), 24)

const { malformedDocument } = await import('./grammar.ts')
const grammar = normalizeMarkdownDocument(malformedDocument)
const malformedHtml = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { document: malformedDocument }) }))
assert(!malformedHtml.includes('drop '), 'Invalid subtrees are dropped deterministically')
assert(malformedHtml.includes('<p>before<strong></strong>after</p>'))
assert(malformedHtml.includes('<thead><tr><th>Head</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody>'))
assert.equal(grammar.nodes.length, 9)
const validSource = '# Heading\n\nText **strong [link](https://example.com)** and *emphasis*, ~~deleted~~, `inline`.\n\n> quote\n>\n> - item\n>   - nested\n\n3. Third\n4. Fourth\n\n| A | B |\n|---|---|\n| cell | other |\n\n---\n\n```ts\nconst x = 1\n```'
const parsedNormal = await parseMarkdown(validSource)
assert.deepEqual(normalizeMarkdownDocument(parsedNormal), parsedNormal, 'All normal parser-generated constructs are preserved')
console.info('HTML parent/child grammar: phrasing, anchors, list/table hierarchy, voids, code placement and parser preservation passed')

for (const value of ['a\rb', 'a\r\nb', 'a\u0000b', '\uD800', '\uDC00']) {
  assert.equal(normalizeMarkdownDocument({ version: 1, nodes: [{ kind: 'text', text: value }, { kind: 'code', language: 'text', text: value }] }).nodes.length, 0)
}
const paired = normalizeMarkdownDocument({ version: 1, nodes: [{ kind: 'text', text: '😀' }, { kind: 'code', language: 'javascript', text: '😀', lines: [[{ text: '\uD83D' }, { text: '\uDE00' }]] }] })
assert.deepEqual(paired.nodes, [{ kind: 'text', text: '😀' }, { kind: 'code', language: 'javascript', text: '😀' }], 'Split surrogate highlight spans fall back to exact valid plaintext')
const canonicalText = await parseMarkdown('a\r\nb\u0000c 😀')
assert.deepEqual(normalizeMarkdownDocument(canonicalText), canonicalText, 'Parser canonical CR/NUL output and valid paired Unicode survive')

assert.deepEqual(normalizeMarkdownDocument({ version: 1, nodes: [{ kind: 'element', tag: 'a', href: '/bad\uD800', children: [] }] }).nodes, [{ kind: 'element', tag: 'a', children: [], href: undefined }], 'Loaded href attributes also remain HTML round-trippable')
