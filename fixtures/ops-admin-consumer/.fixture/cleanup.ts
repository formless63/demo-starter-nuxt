import { readFile, rm } from 'node:fs/promises'
import postgres from 'postgres'
let state: { database: string }
try { state = JSON.parse(await readFile('.fixture/state.json', 'utf8')) }
catch { process.exit(0) }
if (!/^ops_fixture_[a-f0-9]{32}$/u.test(state.database)) throw new Error('Invalid disposable fixture name')
const admin = postgres(process.env.DATABASE_URL!, { max: 1 })
try { await admin.unsafe(`DROP DATABASE IF EXISTS "${state.database}"`) }
finally { await admin.end(); await rm('.fixture/state.json', { force: true }) }
