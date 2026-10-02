import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, isNull } from 'drizzle-orm'
import { createStripeService, StripeCapabilityError } from '@repo/nuxt-stripe/server'
import { stripeBinding } from '@repo/nuxt-stripe/schema'
import { createJobsClient, resolveJobsConfig } from '@repo/nuxt-jobs/server'
import { user } from '../database/schema'
let client: ReturnType<typeof postgres> | undefined
function database() {
  if (!process.env.DATABASE_URL) throw new StripeCapabilityError('unavailable')
  client ??= postgres(process.env.DATABASE_URL, { max: 4, idle_timeout: 20 })
  return drizzle(client)
}
async function ownerExists(id: string) { return Boolean((await database().select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1))[0]) }
export const stripeService = createStripeService({
  database, boss: () => producer.use(),
  authorizeScope: async (actor, scope) => scope.kind === 'user' && scope.id === actor && await ownerExists(actor),
  authorizeBoundResource: async (context, binding) => binding.scopeKind === 'user' && binding.scopeId === context.actorUserId && binding.retiredAt === null,
  async authorizeReconciliation(binding, signal) {
    if (signal.aborted || binding.scopeKind !== 'user' || !await ownerExists(binding.scopeId)) return false
    const [active] = await database().select({ id: stripeBinding.id }).from(stripeBinding).where(and(eq(stripeBinding.id, binding.id), eq(stripeBinding.scopeKind, 'user'), eq(stripeBinding.scopeId, binding.scopeId), eq(stripeBinding.connectionId, binding.connectionId), isNull(stripeBinding.retiredAt))).limit(1)
    return Boolean(active) && !signal.aborted
  },
  // Application operators must wire vetted existing one-time offers and redirects.
  // The reference intentionally has no default offer/customer binding and no provider startup I/O.
})
const producer = createJobsClient({ 'stripe.operation': stripeService.runJob, 'stripe.receipt': stripeService.inboxJob }, resolveJobsConfig, () => {})
export async function closeStripeResources() { await producer.stop(); const active = client; client = undefined; await active?.end() }
