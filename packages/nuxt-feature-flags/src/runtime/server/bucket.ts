import { createHash } from 'node:crypto'
/** Canonical v1 protocol hash; callers validate trusted IDs before evaluation. */
export function rolloutBucket(flagKey: string, identityKind: 'user'|'tenant', identityId: string) {
  const bytes = Buffer.from(JSON.stringify(['feature-flags-v1',flagKey,identityKind,identityId]),'utf8')
  return Math.floor(createHash('sha256').update(bytes).digest().readUInt32BE(0) * 10000 / 4294967296)
}
