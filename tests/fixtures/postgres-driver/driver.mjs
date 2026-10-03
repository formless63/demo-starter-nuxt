import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

assert(process.env.DATABASE_URL, 'A disposable database is required')
export const databaseUrl = new URL(process.env.DATABASE_URL)
assert(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname), 'Only a disposable loopback database is supported')
assert(process.argv[2], 'An installed official driver entry point is required')
export const { default: postgres } = await import(pathToFileURL(process.argv[2]).href)
