import type pg from 'pg'
export async function witness(db: pg.Pool) {
  const [row] = (await db.query("SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) AS digest FROM authorization_assignment t")).rows
  const indexes = (await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename='authorization_assignment' ORDER BY indexname")).rows
  const history = (await db.query('SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id')).rows
  return { row, indexes: Array.from(indexes), history: Array.from(history) }
}
