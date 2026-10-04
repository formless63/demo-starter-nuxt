import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq, isNull } from 'drizzle-orm'
import { createMedusaService, MedusaError } from '@repo/nuxt-medusa/server'
import type { Binding, TrustedContext } from '@repo/nuxt-medusa/server'
import { medusaBinding } from '@repo/nuxt-medusa/schema'
import { createJobsClient, resolveJobsConfig } from '@repo/nuxt-jobs/server'
import { user } from '../database/schema'
let client: pg.Pool | undefined
function database() {
  if (!process.env.DATABASE_URL) throw new MedusaError('unavailable')
  client ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 30_000 }).on('error', () => { /* idle-client errors surface on the next query */ })
  return drizzle(client)
}
async function existingOwner(id: string) {
  const [owner] = await database().select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1)
  return Boolean(owner)
}
async function currentOwnedBinding(binding: Binding) {
  const [current] = await database().select({ id: medusaBinding.id }).from(medusaBinding).where(and(eq(medusaBinding.id, binding.id), eq(medusaBinding.scopeKind, 'user'), eq(medusaBinding.scopeId, binding.scopeId), isNull(medusaBinding.retiredAt))).limit(1)
  return Boolean(current) && await existingOwner(binding.scopeId)
}
export const medusaService = createMedusaService({
  database, boss: () => producer.use(),
  authorizeScope: async (actor, scope) => scope.kind === 'user' && scope.id === actor && await existingOwner(actor),
  authorizeBoundResource: async (ctx, binding) => binding.scopeKind === 'user' && binding.scopeId === ctx.actorUserId && await currentOwnedBinding(binding),
  // Root reference accepts only existing server-owned bindings; no HTTP binding creation.
  authorizeMedusaResource: async (ctx, binding) => ctx.scope.kind === 'user' && binding.scopeId === ctx.actorUserId && await existingOwner(ctx.actorUserId),
  authorizeReconciliation: async (binding, signal) => !signal.aborted && binding.scopeKind === 'user' && await currentOwnedBinding(binding),
})
const producer = createJobsClient({ 'medusa.operation': medusaService.operationJob, 'medusa.inbox': medusaService.inboxJob }, resolveJobsConfig, () => { /* No raw dependency exceptions. */ })
export async function closeMedusaResources() { await medusaService.stop(); await producer.stop(); const active = client; client = undefined; await active?.end() }
export function userContext(actorUserId: string, signal?: AbortSignal): TrustedContext { return { actorUserId, scope: { kind: 'user', id: actorUserId }, signal } }
