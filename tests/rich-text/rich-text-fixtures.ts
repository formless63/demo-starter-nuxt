import type { RichTextDocument } from "../../packages/nuxt-rich-text/src/runtime/document";

const paragraph = (text: string) => ({
	type: "paragraph",
	content: [{ type: "text", text }],
});
export const allFeatures: RichTextDocument = {
	type: "doc",
	content: [
		...([1, 2, 3] as const).map((level) => ({
			type: "heading",
			attrs: { level },
			content: [{ type: "text", text: `Heading ${level}` }],
		})),
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "bold", marks: [{ type: "bold" }] },
				{ type: "text", text: "italic", marks: [{ type: "italic" }] },
				{ type: "text", text: "strike", marks: [{ type: "strike" }] },
				{ type: "text", text: "code", marks: [{ type: "code" }] },
				{ type: "hardBreak" },
				{
					type: "text",
					text: "linked",
					marks: [
						{
							type: "link",
							attrs: { href: "https://example.test/path?q=yes#anchor" },
						},
					],
				},
			],
		},
		{ type: "blockquote", content: [paragraph("quote")] },
		{
			type: "bulletList",
			content: [{ type: "listItem", content: [paragraph("bullet")] }],
		},
		{
			type: "orderedList",
			attrs: { start: 3 },
			content: [
				{
					type: "listItem",
					content: [
						paragraph("ordered"),
						{
							type: "bulletList",
							content: [{ type: "listItem", content: [paragraph("nested")] }],
						},
					],
				},
			],
		},
		{
			type: "codeBlock",
			content: [
				{ type: "text", text: "<script>literal</script>\nconst n = 1;" },
			],
		},
		{ type: "paragraph" },
	],
};
