import { validateGraph } from '@repo/nuxt-flow-canvas/graph'

// Validate loaded records BEFORE Nuxt serializes payloads. A component cannot
// detect an invalid surrogate after a transport has replaced it with U+FFFD.
export default defineEventHandler(() => validateGraph({ schemaVersion: 1, nodes: [
  { id: 'alpha', kind: 'default', position: { x: 30, y: 50 }, label: 'Alpha café 🧭' },
  { id: 'beta', kind: 'default', position: { x: 300, y: 180 }, label: 'Beta' },
], edges: [] }))
