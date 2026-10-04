import type pg from 'pg'

export async function witness(db: pg.Pool) {
  const rows = []
  for (const name of ['organization', 'member', 'invitation', 'session', 'user']) {
    // Table names are this fixed fixture allowlist; no external input is interpolated.
    const [row] = (await db.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id),'')) AS digest FROM "${name}" t`)).rows
    rows.push({ table: name, count: row?.count, digest: row?.digest })
  }
  const indexes = (await db.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`)).rows
  const history = Array.from((await db.query(`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`)).rows)
  return { rows, indexes: Array.from(indexes), history }
}
