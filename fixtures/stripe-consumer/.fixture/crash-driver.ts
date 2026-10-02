import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createStripeService } from '@repo/nuxt-stripe/server'
const sql = postgres(process.env.DATABASE_URL!, { max: 2 })
const service = createStripeService({
  database: () => drizzle(sql), boss: async () => { throw new Error('No enqueue in driver') },
  env: { NODE_ENV: 'test' },
  resolveConnection: async () => ({ id: 'default', secretKey: 'sk_test_fixture', accountId: 'acct_expected', mode: 'test', webhookSecrets: ['whsec_fixture'], apiBase: process.env.STRIPE_FIXTURE_URL! }),
  authorizeScope: async (actor, scope) => scope.kind === 'user' && scope.id === actor,
  authorizeBoundResource: async (context, binding) => context.scope.id === binding.scopeId && binding.retiredAt === null,
})
try { await service.runJob.handler(service.runJob.payload.parse({ operationId: process.argv[2] }), { id: '11111111-1111-4111-8111-111111111111', signal: new AbortController().signal, retryCount: 0, retryLimit: 5 }) }
finally { await sql.end() }
