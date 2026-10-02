# Rich Text / Tiptap

Status: `in-progress`. Independent opt-in private package `@repo/nuxt-rich-text`; `defaultInstalled: false`, no hard capability dependencies, external services, migrations or credentials. Exact hosted browser and full CI remain completion gates.

## Installation and contract

Install the package and explicitly add `@repo/nuxt-rich-text` to Nuxt `modules`. The module registers `RichTextContent` and `RichTextEditor`. Import types, `parseRichTextDocument`, `emptyRichTextDocument`, `isSafeRichTextLink`, and `richTextLimits` from `@repo/nuxt-rich-text/runtime`.

Both components accept `value` and `label`. The editor additionally accepts `readOnly` and `onChange(next)`. A controlled caller must synchronously update its reactive value inside the callback to accept a proposed edit; retaining the value rejects it. Persistence, authentication, authorization, concurrency and server-side revalidation are caller-owned. Never treat browser validation as authorization.

The closed JSON v1 schema accepts doc, paragraphs, headings 1–3, bullet/ordered lists, paragraph-first list items, blockquotes, code blocks, text and hard breaks. Marks are bold, italic, strike, inline code, and safe absolute HTTP(S)/mailto links without credentials or whitespace. Inline code excludes other marks. Ordered starts are integers 1–1,000,000. Limits: 2,000 nodes, depth 24, 100,000 UTF-16 characters and 262,144 serialized UTF-8 bytes. Validation copies canonical data, merges adjacent identically marked text, sorts marks, rejects cycles, accessors, unexpected attributes and executable HTML nodes. Errors omit the input.

Vue SSR creates escaped native elements without HTML injection or browser imports. The first browser render matches SSR; Tiptap loads only after mount. Whitespace is explicitly preserved. Failure retains safe content with a generic load error. Read-only/unmount destroys editor state. External replacement and rejected edits reset the complete ProseMirror state so old/private content cannot return via undo. Accepted edits retain undo. Paste inserts bounded plain text only; all drops are blocked. No uploads, persistence, collaboration, premium extensions, raw HTML import or renderer escape hatch.

Native buttons expose pressed/disabled state, a labeled formatting fieldset, textbox and URL control. Keyboard commands are Tiptap-native; formatting returns focus to the editor. Whole-document formatting converts AllSelection to text selection before commands (including repeated Quote toggles).

## Verification and removal

`bun x vitest run --config vitest.rich-text.config.ts` runs neutral validation and real mounted Vue/Tiptap behavior. `bun run packages:test rich-text` owns packed installation, independent strict types/build, real SSR/UTF-8 response hydration/browser behavior, removal and rebuild. The generic matrix includes this in-progress fixture. Root `/rich-text-test` is a public static example with no persistence or private data, with an explicit hydration readiness marker.

To remove from a consumer, remove the module registration, component usages and imports, then uninstall the package. No data or migrations are deleted. From the reference app additionally remove `app/pages/rich-text-test.vue` and `tests/e2e/rich-text.spec.ts`, root package dependency and catalog reference enablement. Source package and fixture may remain without activating anything.
