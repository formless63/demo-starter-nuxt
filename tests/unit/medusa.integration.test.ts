import { describe, it } from 'vitest'
import pg from 'pg'
import { runContract } from '../../fixtures/medusa-consumer/.fixture/contract'
const suite = process.env.DATABASE_URL ? describe : describe.skip
suite('Medusa local protocol and PostgreSQL durability', () => {
  it('enforces scoped native transport, current authorization, atomic receipt, leases and privacy', async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 }).on('error', () => {}), name = `medusa_root_${crypto.randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${name}"`)
    const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${name}`
    try { await runContract(url.toString()) }
    finally { await admin.query(`DROP DATABASE "${name}"`); await admin.end() }
  }, 30000)
})
