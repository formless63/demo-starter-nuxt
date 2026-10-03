import { readFile, unlink } from 'node:fs/promises'
import postgres from 'postgres'

const statePath = new URL('./state.json', import.meta.url)
let state: { url: string, name: string, adminUrl: string } | undefined
try { state = JSON.parse(await readFile(statePath, 'utf8')) }
catch { /* Runtime failed before retaining its uniquely owned database. */ }
if (state) {
  if (!/^authorization_contract_[0-9a-f]{32}$/.test(state.name)) throw new Error('Invalid fixture cleanup identity')
  const admin = postgres(state.adminUrl, { max: 1 })
  try { await admin.unsafe(`DROP DATABASE "${state.name}" WITH (FORCE)`) }
  finally { await admin.end() }
  await unlink(statePath)
}
