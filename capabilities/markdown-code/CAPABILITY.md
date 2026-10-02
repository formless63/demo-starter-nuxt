# Markdown / Code Content

Private optional Nuxt module `@repo/nuxt-markdown-code`. Status: **done**, backed by [full 23-job hosted CI](https://github.com/formless63/demo-starter-nuxt/actions/runs/37029379598) at `e99539d90020a70028545ac4f252c55c16e3f432`. `defaultInstalled: false`; root deliberately enables the reference page `/markdown`. No hard capability dependencies, database, environment variables, startup services, fetches, migrations, background work or credentials. Object Storage and AI are optional application integrations only.

## Install and boundaries

Add the private package dependency (workspace or packed tarball), then explicitly register `@repo/nuxt-markdown-code` in Nuxt `modules`. The module registers `MarkdownContent`, CSS and the Nitro-only `parseMarkdown` import. Explicit server imports use `@repo/nuxt-markdown-code/server`; native Vue uses `/components` and the framework-neutral serializable vocabulary uses `/types`. Source presence never enables a capability. There is no public npm publishing policy.

Application-owned Nitro handlers parse source and deliver `MarkdownDocument` through `useFetch`; components render only closed whitelisted nodes with Vue `h`, never raw HTML, MDX, scripts, arbitrary attributes or arbitrary tags. Images become alt text. Code is selectable SSR text with a keyboard-focusable region, light/dark fixed token colors, a native copy button and polite status. Clipboard success/failure/repeated/pending actions are guarded against document changes and unmounts; unavailable Clipboard API offers manual copy.

Pinned stable markdown-it 15.0.2 and Shiki 4.5.0 are owned by the package and stay server-only. The module rejects client imports of its server entry. The packed fixture scans the production public bundle to prevent parser, grammar or WASM leakage. Fixed JavaScript/TypeScript/JSON grammars and GitHub light/dark themes use the fine-grained Shiki core; unknown languages and exhausted highlighting budgets render plaintext.

## Nuxt transport boundary

`parseMarkdown` returns an already normalized model. When loading a previously stored or otherwise untrusted document, call `normalizeMarkdownDocument(value)` from `@repo/nuxt-markdown-code/server` inside the Nitro handler **before** returning it to `useFetch`/Nuxt payload serialization. The component revalidates the canonical payload independently, but cannot reconstruct code units lost before it receives them. Never send an unnormalized stored model through the SSR payload and rely only on the component.

Nuxt4.5.2's devalue5.9.4 serializer leaves lone surrogate code units raw; HTTP UTF-8 then replaces them with U+FFFD. A server-only rejection after data has already entered the payload would diverge from client rendering. Pre-transport normalization preserves one canonical model for both. Legitimate U+FFFD and valid paired Unicode remain supported. The fixture reproduces exact serializer/UTF-8 loss and checks canonical equality, raw API/SSR payloads, and actual Chromium hydration without weakening the forged direct-component regressions.

## Content and safety contract

Supports paragraphs, headings, emphasis, strong/deletion, inline/fenced/indented code, blockquotes, bullet/ordered lists (preserving start), breaks, rules, tables and links. No HTML execution, remote ingestion, image requests, custom grammars, embeds, plugins or arbitrary renderer extensions.

Bounds: 65,536 UTF-8 input bytes; 4,096 allocated parser tokens and rendered nodes; depth 24; 32 code blocks and 32,768 code characters. Highlighting: 16,384 characters per document, 8,192 per block, 128 lines per block, 512 characters per line, 8,192 spans total. Parser allocation is capped before sparse tables expand. Inline-code children count toward the node budget. Parsing limits throw `MarkdownLimitError` with a static safe message; highlighting failure falls back to plaintext. Applications own access control and bounded HTTP request bodies before calling this API.

Links permit credential-free HTTPS, simple mailto, root-relative paths except `//`, and fragments. Controls, whitespace, backslashes, other schemes, relative traversals and mailto query fields are rejected. The renderer rechecks hrefs, fixed hex token colors, ordered-list starts and whitelisted tags on deserialized/forged payloads. It never spreads input attributes. JSON-loaded documents are revalidated before rendering; malformed/null models are safely rejected, code/highlight dimensions are bounded before allocation, colored token text must exactly match copied plaintext, and a closed parent/child HTML grammar drops invalid subtrees (block/phrasing, nested anchors, list/table wrappers, code placement and void children) before traversal. Browser HTML repair must never change the hydrated structure. Loaded text/code/highlight spans containing CR, NUL or unpaired UTF-16 surrogates are rejected; valid Unicode and parser-canonical newlines are preserved. Consumers should still use documents returned by the parser.

## Verification and removal

`bun run packages:test markdown-code` runs the generic packed install, strict typecheck, production build, actual shipped parser/Vue SSR contract, mandatory Playwright hydration/copy/security/theme proof, clean removal and independent rebuild. The completed fixture participates in the generic CI matrix and unqualified package build/test selection. Runtime browsers are mandatory, not silently skipped on constrained hosts. Local OS restrictions on Chromium or Nitro sockets must be reported, with hosted CI providing those gates.

Remove the root package dependency and module entry; remove `/markdown` and its application-owned `/api/markdown-reference` handler. Remove `markdown-code` from `referenceApplication.enabledCapabilities`, reinstall, typecheck and build. Application-owned content persists; no data cleanup or migrations are performed. A clean consumer removal fixture retains its baseline home page and public hydration marker.

## Completion evidence

Markdown / Code Content implementation `e99539d90020a70028545ac4f252c55c16e3f432` passed [all 23 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37029379598): all 21 generic packed package lifecycles, corrected real-browser payload/hydration/copy checks, full root checks, production browser/container/health, migrations and worker verification. This is source evidence; metadata promotion and later revisions require their own exact-head CI.
