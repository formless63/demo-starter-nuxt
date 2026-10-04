# Command System evaluation

Nuxt 4 native module plus Vue 3 Composition API. Reka UI 2.10.5 Dialog owns modal focus trapping, Escape, portal semantics and trigger-focus restoration. A small Vue combobox provides deterministic case-insensitive label/keyword filtering, arrow navigation and Enter activation. Vue `useId` provides instance-local hydration-safe ARIA identifiers. No React adapter, global state store, server API or search backend is introduced.

The package owns Reka UI. Vue is a peer of Nuxt. Mod+K uses a lifecycle-managed browser listener and ignores editable targets, repeated/composing keys and already-handled events. Application authorization and route navigation remain caller-owned; hiding a command is never a security boundary.

The execution mutex is independent of the presentation generation. Closing/reopening, controlled prop transitions, and unmount invalidate stale completion/error presentation without permitting overlapping command execution. A callback is not cancelled by dismissing the palette; applications own cancellation and side effects.
