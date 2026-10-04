import type pg from 'pg'
export const statePath = '.fixture/medusa-retained.json'
export async function snapshot(client: pg.Pool) {
  const rows = async (text: string) => (await client.query(text)).rows
  return {
    bindings: [...await rows(`SELECT * FROM medusa_binding ORDER BY id`)],
    projections: [...await rows(`SELECT * FROM medusa_projection ORDER BY binding_id`)],
    operations: [...await rows(`SELECT * FROM medusa_operation ORDER BY id`)],
    inbox: [...await rows(`SELECT * FROM medusa_inbox ORDER BY id`)],
    indexes: [...await rows(`SELECT indexname,indexdef FROM pg_indexes WHERE tablename LIKE 'medusa_%' ORDER BY indexname`)],
    history: [...await rows(`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`)],
    jobs: [...await rows(`SELECT nspname FROM pg_namespace WHERE nspname IN ('medusa_fixture_jobs','medusa_native_jobs') ORDER BY nspname`)],
  }
}
