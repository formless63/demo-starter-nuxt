# Rich Text module evaluation

Native Nuxt module with Vue components and Tiptap 3.31.4. Official [Nuxt installation](https://tiptap.dev/docs/editor/getting-started/install/nuxt) and [Vue 3 integration](https://tiptap.dev/docs/editor/getting-started/install/vue3) recommend `@tiptap/vue-3`, `@tiptap/pm` and `@tiptap/starter-kit`. Installed Vue adapter metadata requires matching core/pm 3.31.4 and Vue ^3.0.0, compatible with the pinned Vue 3.5.43 baseline. All directly used Tiptap packages are pinned together. Only open-source extensions are used.

The framework-neutral schema is shared by contract with the TanStack implementation, while the lifecycle is native Vue: SSR VNodes, mount-only dynamic import, shallow editor ownership, post-flush controlled reconciliation and disposal. No React/Start adapter or root aliases enter the package. A fresh ProseMirror EditorState resets history after rejection/replacement. The AllSelection correction normalizes to text endpoints before block formatting. Explicit pre-wrap preserves spaces despite disabled editor CSS injection.

The independent fixture exercises the actual package, server response bytes decoded as UTF-8, hydration, real Tiptap editing, rejected state and undo clearing, remount/read-only transitions and safe escaped rendering. All page and console errors are asserted. Hosted exact-head CI is required because local browser/Nitro sockets are restricted; no bypass is used. The source has now passed all hosted gates; combined promotion CI is still required.

## Vue state-cache reset

The pinned `@tiptap/vue-3/src/Editor.ts` wraps core Editor with a reactive state cache and updates that cache from the public `beforeTransaction` event's `nextState`. Updating only `editor.view.updateState` leaves `editor.state`, `can().undo()` and later transactions reading stale state/history. A regression demonstrated this with actual Vue/Tiptap. Reconciliation creates a fresh public ProseMirror EditorState, emits the public typed `beforeTransaction` event with that state, and updates the view. No private adapter member is read or changed. Both caches therefore share the same fresh state; history cannot recover rejected or replaced text. Tests execute undo AND redo after both reset cases, rather than checking toolbar appearance alone. Retaining the mounted editor DOM preserves focus while selection resets to the new document's start. Dependency upgrades must reverify the adapter event contract and these regressions.

## Local verification before hosted CI

87 focused tests pass, including closed-schema adversarial inputs, real editor/cache-sensitive undo/redo, canonical all-feature round-trip, SSR Unicode, load failure and Nuxt Vite configuration. Independent strict package typecheck and full root Nuxt typecheck pass. Focused ESLint, catalog/matrix and six cumulative integration governance tests pass. A temporary offline-only orchestration copy (not committed) verified actual packed install, independent consumer typecheck/build, uninstall/dependency absence and final typecheck/rebuild. Browser/runtime checks were deliberately not run locally due the known socket restriction; the committed fixture still requires them, and the later hosted source verification below supplies those runtime results. Frozen lock installation passes.

## Independent review corrections

CRLF/CR are canonicalized to LF; NUL/unpaired UTF-16 are rejected before HTML/UTF-8 transport, including link href values. Valid Unicode and U+FFFD remain valid. Paste normalizes supported newline sequences; internal transactions reject residual CR. A parse5 HTML5-parser test consumes encoded/decoded SSR bytes, avoiding happy-dom's incomplete normalization model. The packed and root browser fixture checks Unicode text after actual response-byte parsing and hydration, explicit HTTP/meta charset and hydration warnings.

Both framework variants now require an explicit caller-owned documentKey string. Stable key preserves ordinary accepted echoes/clones; change it for record switches and intentional resets, including equal JSON. Nuxt keys the actual client component, destroying the previous editor/history. Actual mounted and browser regressions replace PRIVATE with Public, switch to another Public record, and exercise undo/redo without recovering PRIVATE. Changed-content external values and rejected proposals still use the synchronized fresh-state reset described above.

Retired editor callbacks are invalidated synchronously by the Vue before-unmount alive flag, independently of editor destruction. Both onUpdate and onTransaction check it. The real lifecycle regression retains the prior editor/callback across a key change: Vue has already destroyed the old editor (its commands are unavailable), and directly invoking its retained actual update callback produces zero new owner emissions. This closes the delayed/retired callback boundary even if destruction timing changes in a future adapter.

## Source completion and combined promotion gate

Source `1666bb6e252fbedbbe20b545de8117e8a246820f` passed [CI 37031826840](https://github.com/formless63/demo-starter-nuxt/actions/runs/37031826840), all 23 jobs, including actual packed install/types/build/SSR/browser/removal/rebuild and full root development/production browser, container, migration, health and worker gates. Independent re-review closed the Unicode, equal-content record history and retired-callback blockers.

This successor merges accepted Markdown main `073ca065d2e664cf00d8cca1c0e1829301b5e3f7` and promotes the verified Rich Text source to done, yielding 22 completed opt-in/reference-enabled capabilities. Runtime Rich Text source is unchanged. This is source evidence, not a claim that this combined successor has passed: its exact-head full CI and composition review are pending before acceptance.

Local combined-tree checks pass: both affected package preparations, full root strict typecheck and production build, 89 focused tests (the 87 source tests plus real resolved Nuxt/Vite composition and pre-transport serialization tests), six inventory/governance tests, catalog validation, lint and frozen-lock installation. The composition test preserves Data Table/Charts/Tiptap optimizer entries, Markdown's server-boundary plugin/CSS and caller Vite options. Lock audit preserves every existing package resolution from accepted main; accepted Rich Text package runtime is byte-identical; fixture/reference transport checks are strengthened without changing its public API. These local results do not replace the pending combined hosted runtime/full-CI gate.

The pre-transport contract explicitly requires server-side parsing before Nuxt payload serialization and sharing that canonical model between SSR and client. The fixture reproduces the actual pinned devalue/UTF-8 lone-surrogate loss on Bun and Node, then proves validated documents round-trip. Its useAsyncData Unicode example puts canonical LF/emoji/U+FFFD text in the real Nuxt payload; browser checks compare that payload and hydrated DOM. Component-only post-transport validation is not claimed to preserve arbitrary uncanonical input.

## Reviewed promotion source

The Markdown/Rich Text promotion `f1bbea44407704973dd2168cda3c23115028c487` passed [all 24 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37037650525) and independent final composition review. It is the unchanged Rich Text source for this File UI composition. This later composition requires its own exact-head hosted gates and review before acceptance.

## Root browser discovery correction in File UI composition

The reviewed source root test used `rich-text.spec.ts`, but root Playwright selects `**/*.e2e.ts`; historical full-CI success therefore did not execute that root Rich Text test. The independent packed Rich Text browser lifecycle did execute. This composition renames the unchanged root test to `rich-text.e2e.ts` and adds a real Playwright discovery assertion for both Rich Text and File UI. The new combined exact-head CI must supply root development/production browser coverage before acceptance.
