import { Extension, type JSONContent } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { parseRichTextDocument, type RichTextDocument } from './document'
/** Drop only editor-generated defaults; public input always uses the strict parser. */
export function documentFromEditor(input: JSONContent): RichTextDocument {
	function copy(item: JSONContent): unknown {
		return {
			type: item.type,
			...(item.text === undefined ? {} : { text: item.text }),
			...(item.type === "heading"
				? { attrs: { level: item.attrs?.level } }
				: item.type === "orderedList"
					? { attrs: { start: item.attrs?.start } }
					: {}),
			...(item.marks?.length
				? {
						marks: item.marks.map((mark) =>
							mark.type === "link"
								? { type: mark.type, attrs: { href: mark.attrs?.href } }
								: { type: mark.type },
						),
					}
				: {}),
			...(item.content?.length ? { content: item.content.map(copy) } : {}),
		};
	}
	return parseRichTextDocument(copy(input));
}
export const bounds = Extension.create({
	name: "boundedDocument",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				filterTransaction(transaction) {
					if (!transaction.docChanged) return true;
					try {
						documentFromEditor(transaction.doc.toJSON());
						return true;
					} catch {
						return false;
					}
				},
			}),
		];
	},
});
