# File UI evaluation

Native Nuxt 4.5.2/Vue3.5.43 package with no UI upload dependency. Framework-neutral workflow and lifecycle tests are adapted from the reviewed TanStack File UI tree adaf33a8da7dc14a32719311f9c54e719e0a79c5, but transport, database adapter and UI are native Nuxt/Postgres.js/Vue.

Installed H3 1.15.11 source demonstrates readRawBody buffering and getRequestWebStream lacking flow control. The package implements a bounded Node incoming stream instead, with declared/actual byte limits, pause/resume and cancellation. Backendless startup is preserved. AWS SDK comes from existing Object Storage; the File UI factory explicitly forces one PUT attempt while leaving ordinary Storage defaults unchanged.

No claim of durable memory metadata, lease-based stopped-writer proof, zero orphans or browser cancellation rollback. Root durable metadata and clean consumer fixture boundaries are deliberately distinct. Status stays in-progress pending independent security/lifecycle review and exact-head full hosted CI.
