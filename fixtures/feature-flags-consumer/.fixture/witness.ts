import type postgres from 'postgres'
export async function witness(db:postgres.Sql) {
  const tables=[]
  for(const table of ['feature_flag_definition','feature_flag_override']) { const [row]=await db.unsafe(`SELECT count(*)::integer AS count,md5(coalesce(string_agg(row_to_json(t)::text,',' ORDER BY row_to_json(t)::text),'')) AS digest FROM "${table}" t`);tables.push({table,...row}) }
  const indexes=Array.from(await db`SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('feature_flag_definition','feature_flag_override') ORDER BY indexname`)
  const history=Array.from(await db`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`)
  return {tables,indexes,history}
}
