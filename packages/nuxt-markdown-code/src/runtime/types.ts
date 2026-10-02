/** Only this closed vocabulary crosses the server/client boundary. */
export const markdownTags = [
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"blockquote",
	"ul",
	"ol",
	"li",
	"em",
	"strong",
	"s",
	"a",
	"code",
	"hr",
	"br",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
] as const;
export type MarkdownTag = (typeof markdownTags)[number];
export interface HighlightSpan {
	text: string;
	light?: string;
	dark?: string;
}
export type MarkdownNode =
	| { kind: "text"; text: string }
	| {
			kind: "element";
			tag: MarkdownTag;
			children: MarkdownNode[];
			href?: string;
			start?: number;
	  }
	| { kind: "code"; text: string; language: string; lines?: HighlightSpan[][] };
export interface MarkdownDocument {
	version: 1;
	nodes: MarkdownNode[];
}

/** Deliberately narrow: content cannot opt into arbitrary navigation schemes. */
export function safeMarkdownHref(value: string): string | undefined {
	// eslint-disable-next-line no-control-regex -- Reject controls, never normalize them.
	if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
	if (value.startsWith("#")) return value;
	if (value.startsWith("/") && !value.startsWith("//")) return value;
	if (/^mailto:[A-Z0-9._+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value))
		return value;
	try {
		const url = new URL(value);
		if (
			/^https:\/\//i.test(value) &&
			url.protocol === "https:" &&
			!url.username &&
			!url.password
		)
			return url.href;
	} catch {
		/* Invalid or unsupported relative URL. */
	}
}

/** Revalidate JSON-loaded documents before creating renderer nodes or token arrays. */
export function normalizeMarkdownDocument(value: unknown): MarkdownDocument {
  const result: MarkdownDocument = { version: 1, nodes: [] }
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!record(value) || value.version !== 1 || !Array.isArray(value.nodes)) return result
  const allowed = new Set<string>(markdownTags)
  const phrasing = new Set(['em', 'strong', 's', 'a', 'code', 'br'])
  const flow = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'hr', 'table', ...phrasing])
  type Content = 'flow' | 'phrasing' | 'text' | 'list' | 'table' | 'section' | 'row' | 'void'
  const contentOf = (tag: string): Content => {
    if (['blockquote', 'li', 'th', 'td'].includes(tag)) return 'flow'
    if (tag === 'ul' || tag === 'ol') return 'list'
    if (tag === 'table') return 'table'
    if (tag === 'thead' || tag === 'tbody') return 'section'
    if (tag === 'tr') return 'row'
    if (tag === 'hr' || tag === 'br') return 'void'
    if (tag === 'code') return 'text'
    return 'phrasing'
  }
  const accepts = (content: Content, tag: string) => {
    if (content === 'flow') return flow.has(tag)
    if (content === 'phrasing') return phrasing.has(tag)
    if (content === 'list') return tag === 'li'
    if (content === 'table') return tag === 'thead' || tag === 'tbody'
    if (content === 'section') return tag === 'tr'
    if (content === 'row') return tag === 'th' || tag === 'td'
    return false
  }
  let nodes = 0
  let bytes = 0
  let codeBlocks = 0
  let codeCharacters = 0
  let highlightCharacters = 0
  let spans = 0
  // HTML parsing normalizes CR/NUL, while UTF-8 replaces lone surrogates.
  // Reject those loaded values rather than display/copy a different string.
  const roundTrips = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i)
      if (unit === 0 || unit === 13) return false
      if (unit >= 0xD800 && unit <= 0xDBFF) {
        const next = value.charCodeAt(++i)
        if (!(next >= 0xDC00 && next <= 0xDFFF)) return false
      }
      else if (unit >= 0xDC00 && unit <= 0xDFFF) return false
    }
    return true
  }
  const text = (value: unknown, max = 65536): value is string => {
    if (typeof value !== 'string' || value.length > max || bytes + value.length > 65536 || !roundTrips(value)) return false
    const size = new TextEncoder().encode(value).byteLength
    if (bytes + size > 65536) return false
    bytes += size
    return true
  }
  const hex = (value: unknown) => typeof value === 'string' && /^#[a-f\d]{6}([a-f\d]{2})?$/i.test(value) ? value : undefined
  const normalize = (values: unknown[], depth: number, content: Content, inAnchor = false): MarkdownNode[] => {
    const output: MarkdownNode[] = []
    if (depth > 24 || content === 'void') return output
    let tableHead = false
    let tableBody = false
    for (let i = 0; i < values.length && nodes < 4096; i++) {
      nodes++
      const node = values[i]
      if (!record(node)) continue
      if (node.kind === 'text') {
        if (['flow', 'phrasing', 'text'].includes(content) && text(node.text)) output.push({ kind: 'text', text: node.text })
        continue
      }
      if (node.kind === 'code') {
        if (content !== 'flow' || ++codeBlocks > 32 || typeof node.text !== 'string' || codeCharacters + node.text.length > 32768 || !text(node.text, 32768)) continue
        codeCharacters += node.text.length
        const language = typeof node.language === 'string' && ['javascript', 'typescript', 'json'].includes(node.language) ? node.language : 'text'
        const code: Extract<MarkdownNode, { kind: 'code' }> = { kind: 'code', text: node.text, language }
        output.push(code)
        if (language === 'text' || node.text.length > 8192 || highlightCharacters + node.text.length > 16384 || !Array.isArray(node.lines) || node.lines.length > 128) continue
        const lines: HighlightSpan[][] = []
        let characters = 0
        let valid = true
        // Check dimensions and text lengths before allocating each nested array.
        for (let row = 0; row < node.lines.length && valid; row++) {
          const rawLine = node.lines[row]
          if (!Array.isArray(rawLine) || rawLine.length > 8192 - spans) { valid = false; break }
          const line: HighlightSpan[] = []
          let lineCharacters = 0
          for (const raw of rawLine) {
            if (++spans > 8192 || !record(raw) || typeof raw.text !== 'string' || raw.text.length > 512 || !roundTrips(raw.text) || /[\r\n]/.test(raw.text) || lineCharacters + raw.text.length > 512 || characters + raw.text.length > node.text.length) { valid = false; break }
            lineCharacters += raw.text.length
            characters += raw.text.length
            line.push({ text: raw.text, light: hex(raw.light), dark: hex(raw.dark) })
          }
          lines.push(line)
        }
        if (valid && lines.map(line => line.map(span => span.text).join('')).join('\n') === node.text) {
          highlightCharacters += node.text.length
          code.lines = lines
        }
        continue
      }
      if (depth >= 24 || node.kind !== 'element' || typeof node.tag !== 'string' || !allowed.has(node.tag) || !accepts(content, node.tag) || (node.tag === 'a' && inAnchor) || !Array.isArray(node.children)) continue
      // Keep the closed table vocabulary ordered; never rely on browser repair.
      if (content === 'table') {
        if (node.tag === 'thead') {
          if (tableHead || tableBody) continue
          tableHead = true
        }
        else tableBody = true
      }
      const element: Extract<MarkdownNode, { kind: 'element' }> = { kind: 'element', tag: node.tag as MarkdownTag, children: normalize(node.children, depth + 1, contentOf(node.tag), inAnchor || node.tag === 'a') }
      if (node.tag === 'a') element.href = safeMarkdownHref(typeof node.href === 'string' && node.href.length <= 2048 && roundTrips(node.href) ? node.href : '')
      if (node.tag === 'ol' && typeof node.start === 'number' && Number.isSafeInteger(node.start) && node.start >= 0 && node.start <= 999999999) element.start = node.start
      output.push(element)
    }
    return output
  }
  result.nodes = normalize(value.nodes, 0, 'flow')
  return result
}
