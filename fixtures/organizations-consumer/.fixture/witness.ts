import type postgres from 'postgres'

export async function witness(db: ReturnType<typeof postgres>) {
  const rows = []
  for (const name of ['organization', 'member', 'invitation', 'session', 'user']) {
    // Table names are this fixed fixture allowlist; no external input is interpolated.
    const [row] = await db.unsafe(`SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id),'')) AS digest FROM "${name}" t`)
    rows.push({ table: name, count: row?.count, digest: row?.digest })
  }
  const indexes = await db`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`
  return { rows, indexes: Array.from(indexes) }
}
