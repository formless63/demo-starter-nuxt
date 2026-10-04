# Markdown / Code Content evaluation

Status: **done**, after [all 23 hosted CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37029379598) passed at `e99539d90020a70028545ac4f252c55c16e3f432`. Framework-neutral contract mirrors the hardened TanStack implementation; Nuxt uses a native private module, Nitro server parsing and native Vue rendering. There is no React or TanStack Start wiring.

Choose stable markdown-it 15.0.2 for explicitly disabled raw HTML and bounded token processing; Shiki 4.5.0 fine-grained core loads only fixed JS/TS/JSON grammars, two themes and the server-only Oniguruma engine. See [markdown-it](https://github.com/markdown-it/markdown-it), [Shiki fine-grained bundles](https://shiki.style/guide/bundles), and [Nuxt module authoring](https://nuxt.com/docs/4.x/guide/going-further/modules).

The server returns serializable closed nodes rather than HTML. Vue escapes text and independently revalidates URL and token-color fields. Input, allocation, nesting, code and highlighting budgets prevent amplification. Regression tests cover sparse tables, inline-code node allocation, ordered starts, hostile HTML/schemes, image alt-only output, exact highlighted text roundtrip and bounded fallback.

No external service, fetching, environment, auth, database or capability dependency is required. Applications own content storage and source permissions. The reference application enables the package explicitly; default installation remains false. Rendering arbitrary documents or implementing an editor is not this capability.

Verification must cover packed strict types/build/SSR/browser/install/removal and root production/browser checks. Local SSR/DOM/unit evidence is supplementary; OS-blocked Chromium/Nitro sockets do not waive hosted gates. Do not promote the catalog before full CI is green.

## Local evidence (2026-10-02)

On main `8dfcb998e94950ef5c3a013f29da18f9c00025e1` (18 completed capabilities): frozen install, module build, root strict Nuxt typecheck, full ESLint, 101 agent/governance tests, 3 focused Vitest tests, root production build and actual `/markdown` Node SSR passed. Shipped Bun/Node parser + Vue SSR tests cover syntax/security/budgets; shipped Vue DOM tests cover clipboard ready/pending/repeated/replaced/same-text-document/failed/unavailable/unmounted flows. Root public output contains no parser, grammar or WASM. The packed external consumer passed strict typecheck/build, Node SSR, Bun/Node contract, DOM and public-bundle checks before stopping at the mandatory unavailable local Chromium gate. That checkpoint awaited hosted real-browser/removal evidence, which subsequently passed in the completion run below.

A full unchanged Jobs module regeneration was SIGKILLed by host memory pressure. Subsequent root local checks reused baseline built package artifacts only after byte-for-byte equality of every tracked package source file, and rebuilt Markdown/Data Table. This is supplementary local evidence, not a substitute for fresh full hosted package/application CI. Status remained in-progress at that earlier local checkpoint.

Independent review found that whitelisted tags alone still permitted invalid parent/child HTML and browser repair during hydration. The shared normalizer now enforces a closed content grammar before traversal/allocation, drops invalid subtrees and preserves all tested parser-produced constructs. Shipped Vue SSR-to-DOM-to-hydration tests and a mandatory packed Chromium malformed-model route guard this robustness boundary.

Hosted malformed-model hydration exposed a real Nuxt payload boundary: devalue5.9.4 leaves lone surrogate code units raw and UTF-8 changes them to legitimate U+FFFD before client hydration. The component could not infer their origin. Server parsing now returns normalized models; stored-model handlers explicitly normalize before Nuxt transport, while the component retains independent validation. A pinned test-only serializer fixture proves the loss and verifies canonical SSR/client equality without rejecting legitimate replacement characters.

Main793a05ab integration preserves20 completed baseline capabilities, project-isolated browser configuration, Stripe clock checks, and shared hydration readiness. Three-way semantic lock merge retained all dependency versions; frozen installation passed. Markdown remained in-progress at this integration checkpoint and stays defaultInstalled:false after completion.

Merged-main local gates: frozen install, narrow conflict/semantic audit (782 untouched main files byte-identical),102 agent/governance tests,7 focused Markdown/browser-project-order/dev-dependency tests, strict source typecheck, targeted lint, package build, shipped Bun/Node parser/SSR, native Vue hydration/clipboard, and actual devalue/UTF-8 transport regressions passed. The two newly enabled baseline package artifacts were reused only after exact tracked-source equality with the accepted UI integration. Final merged20-capability root Nuxt prepare, independent strict typecheck, production build, actual Node SSR and public parser/grammar/WASM absence checks also passed after the heavy slot became available. Fresh full exact-head hosted CI is decisive and has not been waived.

## Completion evidence

Markdown / Code Content implementation `e99539d90020a70028545ac4f252c55c16e3f432` passed [all 23 CI jobs](https://github.com/formless63/demo-starter-nuxt/actions/runs/37029379598): all 21 generic packed package lifecycles, corrected real-browser payload/hydration/copy checks, full root checks, production browser/container/health, migrations and worker verification. This is source evidence; metadata promotion and later revisions require their own exact-head CI.

The final promotion changes only catalog status, documentation and governance expectations to 21 completed capabilities. Runtime source, dependencies/lockfile, module configuration, migration history and reference enablement remain identical to the verified implementation. The PR remains draft and unmerged pending final exact-head CI and root review.
