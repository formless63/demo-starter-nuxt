import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { witness } from './witness.ts'
const state=JSON.parse(await readFile(new URL('./state.json',import.meta.url),'utf8')) as {url:string,witness:unknown}
const db=postgres(state.url,{max:1})
try { assert(JSON.stringify(await witness(db))===JSON.stringify(state.witness),'Definitions/targets/indexes/history must survive removal'); console.info('[feature flags fixture] removal retained definitions/overrides/indexes/history; base UI uses explicit false default') } finally { await db.end() }
