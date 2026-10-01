import { FeatureFlagsError } from './errors'
export function key(value: unknown) { if (typeof value !== 'string' || value.length > 128 || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value)) throw new FeatureFlagsError('invalid-input'); return value }
export function opaqueId(value: unknown) { if (typeof value !== 'string' || !value.length || value.length > 128 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new FeatureFlagsError('invalid-input'); return value }
export interface FlagContext { readonly userId?: string, readonly tenantId?: string }
export function context(value: FlagContext = {}): FlagContext { if (!value || typeof value !== 'object' || Object.keys(value).some(field => !['userId','tenantId'].includes(field))) throw new FeatureFlagsError('invalid-input'); return Object.freeze({ userId: value.userId === undefined ? undefined : opaqueId(value.userId), tenantId: value.tenantId === undefined ? undefined : opaqueId(value.tenantId) }) }
export function revision(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new FeatureFlagsError('invalid-input'); return value as number }
export function target(value: { targetKind: 'user'|'tenant', targetId: string }) { if (!value || !['user','tenant'].includes(value.targetKind)) throw new FeatureFlagsError('invalid-input'); return { targetKind: value.targetKind, targetId: opaqueId(value.targetId) } }
export function fields(value: Record<string, unknown>, creating = false) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(field => !['description','enabled','defaultValue','rolloutBasisPoints'].includes(field))) throw new FeatureFlagsError('invalid-input')
  const result: { description?: string, enabled?: boolean, defaultValue?: boolean, rolloutBasisPoints?: number|null } = {}
  if (creating || value.description !== undefined) { if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 200 || [...value.description].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) throw new FeatureFlagsError('invalid-input'); result.description = value.description as string ?? '' }
  for (const field of ['enabled','defaultValue'] as const) if (creating || value[field] !== undefined) { if (value[field] !== undefined && typeof value[field] !== 'boolean') throw new FeatureFlagsError('invalid-input'); result[field] = value[field] as boolean ?? false }
  if (creating || value.rolloutBasisPoints !== undefined) { const n = value.rolloutBasisPoints ?? null; if (n !== null && (!Number.isInteger(n) || Number(n) < 0 || Number(n) > 10000)) throw new FeatureFlagsError('invalid-input'); result.rolloutBasisPoints = n as number|null }
  return result
}
export function pagination(input: {limit?:number,cursor?:string}, override = false) {
  const limit = input.limit ?? 25
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new FeatureFlagsError('invalid-input')
  if (input.cursor === undefined) return { limit, tuple: null }
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(input.cursor) || Buffer.byteLength(input.cursor)>2048) throw 0
    const bytes=Buffer.from(input.cursor,'base64url'); if(bytes.toString('base64url')!==input.cursor)throw 0
    const tuple=JSON.parse(bytes.toString('utf8'))
    if(!Array.isArray(tuple)||tuple.length!==(override?5:3)||tuple[0]!==1||typeof tuple[1]!=='string'||new Date(tuple[1]).toISOString()!==tuple[1])throw 0
    if(override)target({targetKind:tuple[2],targetId:tuple[3]}); else key(tuple[2])
    // Override cursor also binds the definition key, rechecked by the list operation.
    if(override)key(tuple[4])
    if(JSON.stringify(tuple)!==bytes.toString('utf8'))throw 0
    return {limit,tuple:tuple as [number,string,string,string?,string?]}
  } catch { throw new FeatureFlagsError('invalid-input') }
}
