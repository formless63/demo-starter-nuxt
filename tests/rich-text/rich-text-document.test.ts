import { describe, expect, test, vi } from "vitest";
import {
	emptyRichTextDocument,
	isSafeRichTextLink,
	parseRichTextDocument,
	type RichTextNode,
	richTextLimits,
} from "../../packages/nuxt-rich-text/src/runtime/document";
import { allFeatures } from "./rich-text-fixtures";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const paragraph = (text = "hello") => ({
	type: "paragraph",
	content: [{ type: "text", text }],
});
const marked = (...marks: unknown[]) =>
	doc({ type: "paragraph", content: [{ type: "text", text: "hello", marks }] });

describe("closed, bounded rich-text v1 JSON", () => {
	test("copies every supported node/mark without retaining caller-owned objects", () => {
		const parsed = parseRichTextDocument(allFeatures);
		expect(parsed).toEqual(allFeatures);
		expect(parsed).not.toBe(allFeatures);
		expect(parsed.content).not.toBe(allFeatures.content);
		expect(parsed.content[3].content?.[0]).not.toBe(
			allFeatures.content[3].content?.[0],
		);
		expect(parseRichTextDocument(emptyRichTextDocument)).toEqual(
			emptyRichTextDocument,
		);
		expect(
			parseRichTextDocument(
				doc({
					type: "orderedList",
					content: [{ type: "listItem", content: [paragraph()] }],
				}),
			).content[0].attrs,
		).toEqual({ start: 1 });
		expect(parseRichTextDocument(marked())).toEqual(doc(paragraph()));
	});

	test.each([
		["null", null],
		["HTML string", "<p>hello</p>"],
		["array root", []],
		["wrong root", paragraph()],
		["empty document", doc()],
		[
			"unknown node",
			doc({ type: "image", attrs: { src: "https://example.test/a.png" } }),
		],
		["raw HTML node", doc({ type: "html", text: "<script>bad</script>" })],
		["unknown root field", { ...doc(paragraph()), version: 1 }],
		["node event handler", doc({ ...paragraph(), onclick: "alert(1)" })],
		[
			"paragraph attribute",
			doc({ ...paragraph(), attrs: { style: "color:red" } }),
		],
		["heading level four", doc({ type: "heading", attrs: { level: 4 } })],
		["heading missing level", doc({ type: "heading" })],
		[
			"heading extra attribute",
			doc({ type: "heading", attrs: { level: 2, id: "x" } }),
		],
		[
			"zero ordered start",
			doc({
				type: "orderedList",
				attrs: { start: 0 },
				content: [{ type: "listItem", content: [paragraph()] }],
			}),
		],
		[
			"large ordered start",
			doc({
				type: "orderedList",
				attrs: { start: 1_000_001 },
				content: [{ type: "listItem", content: [paragraph()] }],
			}),
		],
		[
			"fractional ordered start",
			doc({
				type: "orderedList",
				attrs: { start: 1.5 },
				content: [{ type: "listItem", content: [paragraph()] }],
			}),
		],
		[
			"string ordered start",
			doc({
				type: "orderedList",
				attrs: { start: "1" },
				content: [{ type: "listItem", content: [paragraph()] }],
			}),
		],
		["empty list", doc({ type: "bulletList" })],
		["empty quote", doc({ type: "blockquote" })],
		["list without items", doc({ type: "bulletList", content: [paragraph()] })],
		["list item at root", doc({ type: "listItem", content: [paragraph()] })],
		[
			"list item starts with heading",
			doc({
				type: "bulletList",
				content: [
					{
						type: "listItem",
						content: [{ type: "heading", attrs: { level: 1 } }],
					},
				],
			}),
		],
		[
			"block nested inside paragraph",
			doc({ type: "paragraph", content: [paragraph()] }),
		],
		["text directly in document", doc({ type: "text", text: "hello" })],
		["hard break at root", doc({ type: "hardBreak" })],
		[
			"hard break with content",
			doc({ type: "paragraph", content: [{ type: "hardBreak", content: [] }] }),
		],
		["empty text", doc(paragraph(""))],
		[
			"nonstring text",
			doc({ type: "paragraph", content: [{ type: "text", text: 1 }] }),
		],
		[
			"text with children",
			doc({
				type: "paragraph",
				content: [{ type: "text", text: "hello", content: [] }],
			}),
		],
		[
			"text with attrs",
			doc({
				type: "paragraph",
				content: [{ type: "text", text: "hello", attrs: {} }],
			}),
		],
		["marks on paragraph", doc({ ...paragraph(), marks: [] })],
		["unknown mark", marked({ type: "underline" })],
		["duplicate mark", marked({ type: "bold" }, { type: "bold" })],
		["extra mark attrs", marked({ type: "bold", attrs: {} })],
		["link missing href", marked({ type: "link", attrs: {} })],
		[
			"link with target",
			marked({
				type: "link",
				attrs: { href: "https://example.test", target: "_blank" },
			}),
		],
		[
			"code block with marks",
			doc({
				type: "codeBlock",
				content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }],
			}),
		],
		[
			"code block with break",
			doc({ type: "codeBlock", content: [{ type: "hardBreak" }] }),
		],
		[
			"prototype pollution key",
			JSON.parse(
				'{"type":"doc","content":[{"type":"paragraph"}],"__proto__":{"polluted":true}}',
			),
		],
	])("rejects malformed input: %s", (_name, input) => {
		expect(() => parseRichTextDocument(input)).toThrowError(
			"Invalid rich-text document",
		);
	});

	test("rejects custom prototypes, symbols, and accessors without running getters", () => {
		const getter = vi.fn(() => "doc");
		const accessor = { content: [paragraph()] };
		Object.defineProperty(accessor, "type", { get: getter });
		expect(() => parseRichTextDocument(accessor)).toThrow(
			"Invalid rich-text document",
		);
		expect(getter).not.toHaveBeenCalled();
		expect(() =>
			parseRichTextDocument(
				Object.assign(Object.create({ inherited: true }), doc(paragraph())),
			),
		).toThrow();
		expect(() =>
			parseRichTextDocument({ ...doc(paragraph()), [Symbol("secret")]: true }),
		).toThrow();
		expect(
			parseRichTextDocument(
				Object.assign(Object.create(null), doc(paragraph())),
			),
		).toEqual(doc(paragraph()));
	});

	test("rejects sparse, accessor, subclass and extra-property arrays without evaluating entries", () => {
		const getter = vi.fn(() => paragraph());
		const accessor = Array(1);
		Object.defineProperty(accessor, "0", { get: getter });
		class CustomArray extends Array<unknown> {}
		const subclass = new CustomArray();
		subclass.push(paragraph());
		const invalidArrays = [
			Array(1),
			accessor,
			Object.assign([paragraph()], { extra: true }),
			Object.assign([paragraph()], { [Symbol("extra")]: true }),
			subclass,
		];
		for (const content of invalidArrays)
			expect(() => parseRichTextDocument({ type: "doc", content })).toThrow(
				"Invalid rich-text document",
			);
		expect(getter).not.toHaveBeenCalled();
		const markGetter = vi.fn(() => ({ type: "bold" }));
		const marks = Array(1);
		Object.defineProperty(marks, "0", { get: markGetter });
		expect(() =>
			parseRichTextDocument(
				doc({
					type: "paragraph",
					content: [{ type: "text", text: "hello", marks }],
				}),
			),
		).toThrow();
		expect(markGetter).not.toHaveBeenCalled();
		expect(() =>
			parseRichTextDocument(
				doc({
					type: "paragraph",
					content: [{ type: "text", text: "hello", marks: Array(1) }],
				}),
			),
		).toThrow();
	});

	test("canonicalizes mixed mark ordering without mutating the caller and rejects inline-code combinations", () => {
		const input = marked(
			{ type: "strike" },
			{ type: "italic" },
			{ type: "link", attrs: { href: "https://example.test" } },
			{ type: "bold" },
		);
		const parsed = parseRichTextDocument(input);
		expect(
			parsed.content[0].content?.[0].marks?.map((mark) => mark.type),
		).toEqual(["link", "bold", "italic", "strike"]);
		expect(JSON.stringify(input)).toContain('"marks":[{"type":"strike"}');
		expect(parseRichTextDocument(parsed)).toEqual(parsed);
		expect(() =>
			parseRichTextDocument(marked({ type: "code" }, { type: "bold" })),
		).toThrow();
		expect(() =>
			parseRichTextDocument(
				marked(
					{ type: "code" },
					{ type: "link", attrs: { href: "https://example.test" } },
				),
			),
		).toThrow();
	});

	test("rejects cycles with a fixed error and permits independently copied shared branches", () => {
		const cycle: RichTextNode = { type: "blockquote", content: [] };
		cycle.content?.push(cycle);
		expect(() => parseRichTextDocument(doc(cycle))).toThrowError(
			/^Invalid rich-text document$/,
		);
		const shared = paragraph("secret-value");
		const copied = parseRichTextDocument(doc(shared, shared));
		expect(copied.content[0]).not.toBe(copied.content[1]);
		expect(() =>
			parseRichTextDocument(doc({ type: "secret-value" })),
		).toThrowError(/^Invalid rich-text document$/);
	});

	test("enforces total node count including the root, at the exact boundary", () => {
		expect(
			parseRichTextDocument(
				doc(
					...Array.from({ length: richTextLimits.nodes - 1 }, () => ({
						type: "paragraph",
					})),
				),
			).content,
		).toHaveLength(richTextLimits.nodes - 1);
		expect(() =>
			parseRichTextDocument(
				doc(
					...Array.from({ length: richTextLimits.nodes }, () => ({
						type: "paragraph",
					})),
				),
			),
		).toThrow();
	});

	test("enforces nesting depth without blowing the call stack", () => {
		let nested: RichTextNode = { type: "paragraph" };
		for (let level = 1; level < richTextLimits.depth; level++)
			nested = { type: "blockquote", content: [nested] };
		expect(parseRichTextDocument(doc(nested))).toBeDefined();
		expect(() =>
			parseRichTextDocument(doc({ type: "blockquote", content: [nested] })),
		).toThrow();
	});

	test("bounds aggregate characters, not each text node separately", () => {
		expect(
			parseRichTextDocument(
				doc(paragraph("a".repeat(richTextLimits.characters))),
			),
		).toBeDefined();
		expect(() =>
			parseRichTextDocument(
				doc(paragraph("a".repeat(richTextLimits.characters)), paragraph("b")),
			),
		).toThrow();
		expect(() =>
			parseRichTextDocument(
				doc(paragraph("a".repeat(richTextLimits.characters + 1))),
			),
		).toThrow();
	});

	test("coalesces adjacent text with identical canonical marks while preserving breaks and differing marks", () => {
		const input = doc({
			type: "paragraph",
			content: [
				{ type: "text", text: "Hel" },
				{ type: "text", text: "lo", marks: [] },
				{ type: "hardBreak" },
				{
					type: "text",
					text: "one",
					marks: [{ type: "italic" }, { type: "bold" }],
				},
				{
					type: "text",
					text: "two",
					marks: [{ type: "bold" }, { type: "italic" }],
				},
				{ type: "text", text: "plain" },
			],
		});
		expect(parseRichTextDocument(input)).toEqual(
			doc({
				type: "paragraph",
				content: [
					{ type: "text", text: "Hello" },
					{ type: "hardBreak" },
					{
						type: "text",
						text: "onetwo",
						marks: [{ type: "bold" }, { type: "italic" }],
					},
					{ type: "text", text: "plain" },
				],
			}),
		);
		expect(JSON.stringify(input)).toContain('"text":"Hel"');
	});

	test("accepts the exact UTF-8 byte boundary and rejects one extra byte", () => {
		const overhead =
			new TextEncoder().encode(JSON.stringify(doc(paragraph("a")))).length - 1;
		const remaining = richTextLimits.bytes - overhead;
		const text =
			"界".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
		expect(
			new TextEncoder().encode(JSON.stringify(doc(paragraph(text)))).length,
		).toBe(richTextLimits.bytes);
		expect(parseRichTextDocument(doc(paragraph(text)))).toBeDefined();
		expect(() => parseRichTextDocument(doc(paragraph(`${text}a`)))).toThrow();
	});

	test("bounds encoded UTF-8 JSON independently of character count", () => {
		expect(() =>
			parseRichTextDocument(doc(paragraph("界".repeat(90_000)))),
		).toThrow();
		expect(
			parseRichTextDocument(doc(paragraph("界".repeat(80_000)))),
		).toBeDefined();
		expect(() =>
			parseRichTextDocument(doc(paragraph("\u0000".repeat(50_000)))),
		).toThrow();
	});
});

describe("safe absolute link allowlist", () => {
	test.each([
		"https://example.test",
		"http://example.test/path?q=a&b=c#hash",
		"mailto:hello@example.test",
		"HTTPS://example.test",
		"https://example.test/%3Cscript%3E",
	])("allows %s", (value) => {
		expect(isSafeRichTextLink(value)).toBe(true);
		expect(
			parseRichTextDocument(marked({ type: "link", attrs: { href: value } })),
		).toBeDefined();
	});
	test.each([
		"javascript:alert(1)",
		"JaVaScRiPt:alert(1)",
		"data:text/html,<script>x</script>",
		"vbscript:alert(1)",
		"file:///etc/passwd",
		"ftp://example.test",
		"//example.test",
		"/relative",
		"#fragment",
		"https://name:secret@example.test",
		"https://name@example.test",
		"https://example.test/white space",
		"https://example.test/\nhello",
		" https://example.test",
		"https://example.test/\u007f",
		"mailto:",
		"",
		`https://example.test/${"a".repeat(2048)}`,
		null,
		1,
	])("rejects %s", (value) => {
		expect(isSafeRichTextLink(value)).toBe(false);
		expect(() =>
			parseRichTextDocument(marked({ type: "link", attrs: { href: value } })),
		).toThrow();
	});
});

 test('canonicalizes HTML newline handling and rejects non-roundtripping UTF-16', () => {
   expect(parseRichTextDocument(doc(paragraph('a\r\nb\rc'))).content[0]!.content![0]!.text).toBe('a\nb\nc')
   for (const text of ['a\u0000b', '\uD800', '\uDC00', 'x\uD800y', '\uD800\uD800']) expect(() => parseRichTextDocument(doc(paragraph(text)))).toThrow('Invalid rich-text document')
   expect(parseRichTextDocument(doc(paragraph('😀 �'))).content[0]!.content![0]!.text).toBe('😀 �')
 })

test('links reject unpaired UTF-16 before HTML transport', () => { expect(isSafeRichTextLink('https://example.test/\uD800')).toBe(false); expect(isSafeRichTextLink('https://example.test/😀�')).toBe(true) })
