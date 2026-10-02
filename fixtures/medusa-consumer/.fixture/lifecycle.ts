import type postgres from 'postgres'
export const statePath = '.fixture/medusa-retained.json'
export async function snapshot(client: ReturnType<typeof postgres>) {
  return {
    bindings: [...await client`SELECT * FROM medusa_binding ORDER BY id`],
    projections: [...await client`SELECT * FROM medusa_projection ORDER BY binding_id`],
    operations: [...await client`SELECT * FROM medusa_operation ORDER BY id`],
    inbox: [...await client`SELECT * FROM medusa_inbox ORDER BY id`],
    indexes: [...await client`SELECT indexname,indexdef FROM pg_indexes WHERE tablename LIKE 'medusa_%' ORDER BY indexname`],
    history: [...await client`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`],
    jobs: [...await client`SELECT nspname FROM pg_namespace WHERE nspname='medusa_fixture_jobs'`],
  }
}
