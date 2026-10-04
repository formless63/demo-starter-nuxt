import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { createInvoiceNinjaService, InvoiceNinjaError } from '@repo/nuxt-invoice-ninja/server'
import { createJobsClient, resolveJobsConfig } from '@repo/nuxt-jobs/server'
import { user } from '../database/schema'
let client: pg.Pool | undefined
function database() {
  if (!process.env.DATABASE_URL) throw new InvoiceNinjaError('unavailable')
  client ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 30_000 }).on('error', () => { /* idle-client errors surface on the next query */ })
  return drizzle(client)
}
async function existingOwner(id: string) {
  const [owner] = await database().select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1)
  return Boolean(owner)
}
export const invoiceNinjaService = createInvoiceNinjaService({
  database, boss: () => producer.use(),
  authorizeScope: async (actor, scope) => scope.kind === 'user' && actor === scope.id && await existingOwner(actor),
  authorizeBoundResource: async (context, binding) => binding.scopeKind === 'user' && binding.scopeId === context.actorUserId && await existingOwner(context.actorUserId),
  authorizeReconciliation: async (binding, signal) => !signal.aborted && binding.scopeKind === 'user' && binding.retiredAt === null && await existingOwner(binding.scopeId),
  // No company/currency/unsent-policy evidence is installed by the reference app.
  // Operators wire vetted currency resolution and draft policy explicitly on their server.
})
const producer = createJobsClient({ 'invoice-ninja.operation': invoiceNinjaService.operationJob, 'invoice-ninja.receipt': invoiceNinjaService.receiptJob }, resolveJobsConfig, () => {})
export async function closeInvoiceNinjaResources() { await producer.stop(); const active = client; client = undefined; await active?.end() }
