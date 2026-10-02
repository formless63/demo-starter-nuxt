# Markdown / Code Content evaluation

Status: in-progress. Framework-neutral contract mirrors the hardened TanStack implementation; Nuxt uses a native private module, Nitro server parsing and native Vue rendering. There is no React or TanStack Start wiring.

Choose stable markdown-it 15.0.2 for explicitly disabled raw HTML and bounded token processing; Shiki 4.5.0 fine-grained core loads only fixed JS/TS/JSON grammars, two themes and the server-only Oniguruma engine. See [markdown-it](https://github.com/markdown-it/markdown-it), [Shiki fine-grained bundles](https://shiki.style/guide/bundles), and [Nuxt module authoring](https://nuxt.com/docs/4.x/guide/going-further/modules).

The server returns serializable closed nodes rather than HTML. Vue escapes text and independently revalidates URL and token-color fields. Input, allocation, nesting, code and highlighting budgets prevent amplification. Regression tests cover sparse tables, inline-code node allocation, ordered starts, hostile HTML/schemes, image alt-only output, exact highlighted text roundtrip and bounded fallback.

No external service, fetching, environment, auth, database or capability dependency is required. Applications own content storage and source permissions. The reference application enables the package explicitly; default installation remains false. Rendering arbitrary documents or implementing an editor is not this capability.

Verification must cover packed strict types/build/SSR/browser/install/removal and root production/browser checks. Local SSR/DOM/unit evidence is supplementary; OS-blocked Chromium/Nitro sockets do not waive hosted gates. Do not promote the catalog before full CI is green.

## Local evidence (2026-10-02)

On main `8dfcb998e94950ef5c3a013f29da18f9c00025e1` (18 completed capabilities): frozen install, module build, root strict Nuxt typecheck, full ESLint, 101 agent/governance tests, 3 focused Vitest tests, root production build and actual `/markdown` Node SSR passed. Shipped Bun/Node parser + Vue SSR tests cover syntax/security/budgets; shipped Vue DOM tests cover clipboard ready/pending/repeated/replaced/same-text-document/failed/unavailable/unmounted flows. Root public output contains no parser, grammar or WASM. The packed external consumer passed strict typecheck/build, Node SSR, Bun/Node contract, DOM and public-bundle checks before stopping at the mandatory unavailable local Chromium gate. Hosted CI must still prove real browser behavior and downstream generic clean removal/rebuild.

A full unchanged Jobs module regeneration was SIGKILLed by host memory pressure. Subsequent root local checks reused baseline built package artifacts only after byte-for-byte equality of every tracked package source file, and rebuilt Markdown/Data Table. This is supplementary local evidence, not a substitute for fresh full hosted package/application CI. Status remains in-progress.
