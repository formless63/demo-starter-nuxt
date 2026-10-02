/** Version 1 JSON contract. No HTML, network, editor or DOM dependency. */
export type RichTextMark =
	| { type: "bold" | "italic" | "strike" | "code" }
	| { type: "link"; attrs: { href: string } };
export type RichTextNode = {
	type: string;
	attrs?: { level?: number; start?: number };
	text?: string;
	marks?: RichTextMark[];
	content?: RichTextNode[];
};
export type RichTextDocument = RichTextNode & {
	type: "doc";
	content: RichTextNode[];
};
export const richTextLimits = Object.freeze({
	nodes: 2000,
	depth: 24,
	characters: 100_000,
	bytes: 262_144,
});
export const emptyRichTextDocument: RichTextDocument = {
	type: "doc",
	content: [{ type: "paragraph" }],
};
// HTML parsing and UTF-8 encoding must preserve every accepted scalar.
function hasInvalidRichTextScalar(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const unit = value.charCodeAt(index);
		if (unit === 0) return true;
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index++;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
	}
	return false;
}
export function normalizeRichTextText(value: string): string {
	if (hasInvalidRichTextScalar(value)) return invalid();
	return value.replace(/\r\n?/g, "\n");
}
export function isSafeRichTextLink(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length > 2048 ||
		hasInvalidRichTextScalar(value) ||
		/\s/u.test(value) ||
		[...value].some(
			(character) =>
				character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		)
	)
		return false;
	try {
		const url = new URL(value);
		return (
			["https:", "http:", "mailto:"].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			(url.protocol === "mailto:" ? url.pathname.length > 0 : !!url.hostname)
		);
	} catch {
		return false;
	}
}
function invalid(): never {
	throw new Error("Invalid rich-text document");
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		return invalid();
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Reflect.ownKeys(value).some(
			(key) => typeof key !== "string" || !keys.includes(key),
		) ||
		Object.values(descriptors).some((d) => !("value" in d))
	)
		return invalid();
	return value as Record<string, unknown>;
}
function boundedArray(value: unknown, maximum: number): unknown[] {
	if (
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype ||
		value.length > maximum
	)
		return invalid();
	const keys = Reflect.ownKeys(value);
	if (
		keys.length !== value.length + 1 ||
		keys.some(
			(key) =>
				key !== "length" &&
				(typeof key !== "string" ||
					!/^(0|[1-9][0-9]*)$/.test(key) ||
					Number(key) >= value.length),
		)
	)
		return invalid();
	if (
		Object.values(Object.getOwnPropertyDescriptors(value)).some(
			(descriptor) => !("value" in descriptor),
		)
	)
		return invalid();
	return value;
}
const blocks = [
	"paragraph",
	"heading",
	"blockquote",
	"bulletList",
	"orderedList",
	"codeBlock",
];
/** Validate and copy into a bounded closed schema; errors never contain input. */
export function parseRichTextDocument(input: unknown): RichTextDocument {
	let count = 0,
		characters = 0;
	const ancestors = new WeakSet<object>();
	function node(value: unknown, depth: number, parent: string): RichTextNode {
		if (++count > richTextLimits.nodes || depth > richTextLimits.depth)
			return invalid();
		const item = record(value, ["type", "attrs", "text", "marks", "content"]);
		if (ancestors.has(item)) return invalid();
		ancestors.add(item);
		const type = item.type;
		if (typeof type !== "string") return invalid();
		const allowed =
			parent === "root"
				? ["doc"]
				: ["paragraph", "heading", "codeBlock"].includes(parent)
					? parent === "codeBlock"
						? ["text"]
						: ["text", "hardBreak"]
					: ["bulletList", "orderedList"].includes(parent)
						? ["listItem"]
						: blocks;
		if (!allowed.includes(type)) return invalid();
		const result: RichTextNode = { type };
		if (type === "text") {
			if (
				typeof item.text !== "string" ||
				!item.text ||
				item.content !== undefined ||
				item.attrs !== undefined
			)
				return invalid();
			characters += item.text.length;
			if (characters > richTextLimits.characters) return invalid();
			result.text = normalizeRichTextText(item.text);
			if (item.marks !== undefined) {
				if (
					!Array.isArray(item.marks) ||
					item.marks.length > 5 ||
					parent === "codeBlock"
				)
					return invalid();
				const used = new Set<string>();
				result.marks = boundedArray(item.marks, 5).map((mark) => {
					const m = record(mark, ["type", "attrs"]);
					if (typeof m.type !== "string" || used.has(m.type)) return invalid();
					used.add(m.type);
					if (m.type === "link") {
						const attrs = record(m.attrs, ["href"]);
						if (!isSafeRichTextLink(attrs.href)) return invalid();
						return { type: "link", attrs: { href: attrs.href } };
					}
					if (
						!["bold", "italic", "strike", "code"].includes(m.type) ||
						m.attrs !== undefined
					)
						return invalid();
					return { type: m.type } as RichTextMark;
				});
				if (used.has("code") && used.size > 1) return invalid();
				result.marks.sort(
					(a, b) =>
						["link", "bold", "code", "italic", "strike"].indexOf(a.type) -
						["link", "bold", "code", "italic", "strike"].indexOf(b.type),
				);
				if (!result.marks.length) delete result.marks;
			}
		} else {
			if (item.text !== undefined || item.marks !== undefined) return invalid();
			if (type === "heading") {
				const attrs = record(item.attrs, ["level"]);
				if (![1, 2, 3].includes(attrs.level as number)) return invalid();
				result.attrs = { level: attrs.level as number };
			} else if (type === "orderedList") {
				const attrs =
					item.attrs === undefined ? {} : record(item.attrs, ["start"]);
				const start = attrs.start ?? 1;
				if (
					!Number.isInteger(start) ||
					(start as number) < 1 ||
					(start as number) > 1_000_000
				)
					return invalid();
				result.attrs = { start: start as number };
			} else if (item.attrs !== undefined) return invalid();
			if (type === "hardBreak") {
				if (item.content !== undefined) return invalid();
			} else {
				if (item.content !== undefined && !Array.isArray(item.content))
					return invalid();
				const content = boundedArray(item.content ?? [], richTextLimits.nodes);
				if (content.length > richTextLimits.nodes) return invalid();
				const children: RichTextNode[] = [];
				for (const child of content) {
					const next = node(child, depth + 1, type);
					const previous = children.at(-1);
					if (
						previous?.type === "text" &&
						next.type === "text" &&
						JSON.stringify(previous.marks) === JSON.stringify(next.marks)
					)
						previous.text = (previous.text ?? "") + next.text;
					else children.push(next);
				}
				if (
					[
						"doc",
						"blockquote",
						"bulletList",
						"orderedList",
						"listItem",
					].includes(type) &&
					!children.length
				)
					return invalid();
				if (type === "listItem" && children[0]?.type !== "paragraph")
					return invalid();
				if (children.length || type === "doc") result.content = children;
			}
		}
		ancestors.delete(item);
		return result;
	}
	const result = node(input, 0, "root") as RichTextDocument;
	if (
		new TextEncoder().encode(JSON.stringify(result)).length >
		richTextLimits.bytes
	)
		return invalid();
	return result;
}
