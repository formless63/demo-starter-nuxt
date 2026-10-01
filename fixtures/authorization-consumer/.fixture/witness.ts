import type postgres from 'postgres'
export async function witness(db: ReturnType<typeof postgres>) {
  const [row] = await db`SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) AS digest FROM authorization_assignment t`
  const indexes = await db`SELECT indexname,indexdef FROM pg_indexes WHERE tablename='authorization_assignment' ORDER BY indexname`
  const history = await db`SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id`
  return { row, indexes: Array.from(indexes), history: Array.from(history) }
}
