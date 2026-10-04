import type pg from 'pg'
export async function witness(db:pg.Pool) {
  const tables=[]
  for(const table of ['feature_flag_definition','feature_flag_override']) { const [row]=(await db.query(`SELECT count(*)::integer AS count,md5(coalesce(string_agg(row_to_json(t)::text,',' ORDER BY row_to_json(t)::text),'')) AS digest FROM "${table}" t`)).rows;tables.push({table,...row}) }
  const indexes=(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('feature_flag_definition','feature_flag_override') ORDER BY indexname")).rows
  const history=(await db.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows
  return {tables,indexes,history}
}
