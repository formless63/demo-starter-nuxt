import type { Env } from "markdown-it";
import MarkdownIt from "markdown-it";
import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import type { MarkdownDocument, MarkdownNode, MarkdownTag } from "../types";
import { markdownTags, safeMarkdownHref } from "../types";

export const markdownLimits = Object.freeze({
	inputBytes: 65536,
	tokens: 4096,
	depth: 24,
	codeBlocks: 32,
	codeCharacters: 32768,
	highlightCharacters: 16384,
	highlightBlockCharacters: 8192,
	highlightLines: 128,
	highlightLineCharacters: 512,
	highlightSpans: 8192,
});
export class MarkdownLimitError extends Error {
	constructor(readonly allocatedTokens?: number) {
		super("Markdown content exceeds the supported limits.");
		this.name = "MarkdownLimitError";
	}
}
const parser = new MarkdownIt({
	html: false,
	linkify: false,
	typographer: false,
	maxNesting: markdownLimits.depth,
});
// State constructors are exposed by the pinned markdown-it API. Count allocations,
// not only the final tree: sparse tables can otherwise expand a tiny input greatly.
// The budget lives in parse's private environment, never on shared prototypes.
const tokenBudget = Symbol("markdown-token-budget");
function reserveToken(env: Env) {
	const budget = env[tokenBudget] as { allocated: number };
	if (budget.allocated >= markdownLimits.tokens)
		throw new MarkdownLimitError(budget.allocated);
	budget.allocated++;
}
const BlockState = parser.block.State;
parser.block.State = class extends BlockState {
	override push(...args: Parameters<InstanceType<typeof BlockState>["push"]>) {
		reserveToken(this.env);
		return super.push(...args);
	}
};
const InlineState = parser.inline.State;
parser.inline.State = class extends InlineState {
	override push(...args: Parameters<InstanceType<typeof InlineState>["push"]>) {
		reserveToken(this.env);
		return super.push(...args);
	}
	override pushPending() {
		reserveToken(this.env);
		return super.pushPending();
	}
};
const nativeValidateLink = parser.validateLink.bind(parser);
parser.validateLink = (href) =>
	nativeValidateLink(href) && safeMarkdownHref(href) !== undefined;
const tags = new Set<string>(markdownTags);
const languages: Record<string, string> = {
	js: "javascript",
	javascript: "javascript",
	ts: "typescript",
	typescript: "typescript",
	json: "json",
};
let highlighter: ReturnType<typeof createHighlighterCore> | undefined;
function getHighlighter() {
	highlighter ??= createHighlighterCore({
		themes: [
			import("shiki/themes/github-light.mjs"),
			import("shiki/themes/github-dark.mjs"),
		],
		langs: [
			import("shiki/langs/javascript.mjs"),
			import("shiki/langs/typescript.mjs"),
			import("shiki/langs/json.mjs"),
		],
		engine: createOnigurumaEngine(import("shiki/wasm")),
	}).catch((error) => {
		highlighter = undefined;
		throw error;
	});
	return highlighter;
}
type Token = ReturnType<typeof parser.parse>[number];

export async function parseMarkdown(source: string): Promise<MarkdownDocument> {
	if (
		typeof source !== "string" ||
		source.length > markdownLimits.inputBytes ||
		new TextEncoder().encode(source).byteLength > markdownLimits.inputBytes
	)
		throw new MarkdownLimitError();
	const tokens = parser.parse(source, { [tokenBudget]: { allocated: 0 } });
	let count = 0;
	const inspect = (values: Token[], depth: number) => {
		if (depth > markdownLimits.depth) throw new MarkdownLimitError();
		for (const token of values) {
			if (++count > markdownLimits.tokens || token.level > markdownLimits.depth)
				throw new MarkdownLimitError();
			if (token.children) inspect(token.children, depth + 1);
		}
	};
	inspect(tokens, 0);
	let nodes = 0;
	let blocks = 0;
	let codeCharacters = 0;
	let highlightCharacters = 0;
	let spans = 0;
	const code = async (token: Token): Promise<MarkdownNode> => {
		blocks++;
		codeCharacters += token.content.length;
		if (
			blocks > markdownLimits.codeBlocks ||
			codeCharacters > markdownLimits.codeCharacters
		)
			throw new MarkdownLimitError();
		const requested = token.info.trim().split(/\s+/, 1)[0].toLowerCase();
		const language = Object.hasOwn(languages, requested)
			? languages[requested]
			: "text";
		const node: Extract<MarkdownNode, { kind: "code" }> = {
			kind: "code",
			text: token.content,
			language,
		};
		const lines = token.content.split("\n");
		if (
			language === "text" ||
			token.content.length > markdownLimits.highlightBlockCharacters ||
			highlightCharacters + token.content.length >
				markdownLimits.highlightCharacters ||
			lines.length > markdownLimits.highlightLines ||
			lines.some((line) => line.length > markdownLimits.highlightLineCharacters)
		)
			return node;
		highlightCharacters += token.content.length;
		try {
			const result = (await getHighlighter()).codeToTokensWithThemes(
				token.content,
				{
					lang: language,
					themes: { light: "github-light", dark: "github-dark" },
				},
			);
			const total = result.reduce((sum, line) => sum + line.length, 0);
			if (spans + total <= markdownLimits.highlightSpans) {
				spans += total;
				node.lines = result.map((line) =>
					line.map((token) => ({
						text: token.content,
						light: token.variants.light.color,
						dark: token.variants.dark.color,
					})),
				);
			}
		} catch {
			/* Fixed grammar/engine failure degrades to selectable plaintext. */
		}
		return node;
	};
	const convert = async (
		values: Token[],
		depth: number,
	): Promise<MarkdownNode[]> => {
		if (depth > markdownLimits.depth) throw new MarkdownLimitError();
		const root: MarkdownNode[] = [];
		const stack: MarkdownNode[][] = [root];
		const add = (node: MarkdownNode) => {
			if (++nodes > markdownLimits.tokens) throw new MarkdownLimitError();
			stack[stack.length - 1].push(node);
		};
		for (const token of values) {
			if (token.nesting === -1) {
				if (stack.length > 1) stack.pop();
				continue;
			}
			if (token.type === "inline") {
				for (const child of await convert(
					token.children ?? [],
					depth + stack.length - 1,
				))
					stack[stack.length - 1].push(child);
				continue;
			}
			if (token.type === "fence" || token.type === "code_block") {
				add(await code(token));
				continue;
			}
			if (token.type === "image") {
				add({ kind: "text", text: token.content });
				continue;
			}
			if (token.type === "softbreak") {
				add({ kind: "text", text: "\n" });
				continue;
			}
			if (
				token.type === "text" ||
				token.type === "html_inline" ||
				token.type === "html_block"
			) {
				add({ kind: "text", text: token.content });
				continue;
			}
			if (!tags.has(token.tag)) {
				add({ kind: "text", text: token.content });
				continue;
			}
			const node: Extract<MarkdownNode, { kind: "element" }> = {
				kind: "element",
				tag: token.tag as MarkdownTag,
				children: [],
			};
			if (token.tag === "a")
				node.href = safeMarkdownHref(String(token.attrGet("href") ?? ""));
			if (token.tag === "ol") {
				const start = Number(token.attrGet("start") ?? 1);
				if (Number.isSafeInteger(start) && start >= 0 && start <= 999999999)
					node.start = start;
			}
			if (token.type === "code_inline") {
				if (++nodes > markdownLimits.tokens) throw new MarkdownLimitError();
				node.children = [{ kind: "text", text: token.content }];
			}
			add(node);
			if (token.nesting === 1) {
				if (stack.length + depth > markdownLimits.depth)
					throw new MarkdownLimitError();
				stack.push(node.children);
			}
		}
		return root;
	};
	return { version: 1, nodes: await convert(tokens, 0) };
}
