import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createPostgresFileMetadata } from '../server/utils/file-ui-metadata';
import type { FileRecord } from '@repo/nuxt-file-ui/server';
const baseline = JSON.parse(await readFile('fixtures/file-ui-baseline-migrations.json', 'utf8'));
const journal = JSON.parse(await readFile('server/database/migrations/meta/_journal.json', 'utf8'));
assert.deepEqual(journal.entries.slice(0, 12), baseline.entries);
for (const [file, hash] of Object.entries(baseline.hashes)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash);
const adminUrl = process.env.FILE_UI_FIXTURE_DATABASE_URL ?? process.env.DATABASE_URL; assert(adminUrl, 'Disposable PostgreSQL admin URL required');
const admin = postgres(adminUrl, { max: 1 });
try {
 for (const upgrade of [false, true]) {
  const name = `file_ui_${randomUUID().replaceAll('-', '')}`; const url: URL = new URL(adminUrl); url.pathname = `/${name}`;
  const pool = postgres(url.toString(), { max: 8 }); const folder = await mkdtemp(join(tmpdir(), 'file-ui-upgrade-'));
  try {
   await admin.unsafe(`CREATE DATABASE "${name}"`); const db = drizzle(pool);
   if (upgrade) {
    await mkdir(join(folder, 'meta'));
    for (const entry of baseline.entries) await writeFile(join(folder, `${entry.tag}.sql`), await readFile(`server/database/migrations/${entry.tag}.sql`));
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: baseline.entries }));
    await migrate(db, { migrationsFolder: folder });
   }
   await migrate(db, { migrationsFolder: 'server/database/migrations' }); await migrate(db, { migrationsFolder: 'server/database/migrations' });
   const before: Array<{ hash: string; created_at: string }> = (await pool.unsafe('select hash,created_at from drizzle.__drizzle_migrations order by id')); assert.equal(before.length, 13);
   const store = createPostgresFileMetadata(db); const row: FileRecord = { id: randomUUID(), owner: 'synthetic-owner', key: `file-ui/${randomUUID()}`, idempotencyKey: randomUUID(), digest: 'a'.repeat(64), fingerprint: 'b'.repeat(64), name: 'fixture.txt', type: 'text/plain', size: 5, state: 'uploading', writerStopped: false, revision: 0, createdAt: Date.now() };
   const results = await Promise.all(Array.from({ length: 8 }, () => store.reserve({ ...row, id: randomUUID(), key: `file-ui/${randomUUID()}` })));
   assert.equal(results.filter(r => r.created).length, 1); assert.equal(new Set(results.map(r => r.record.id)).size, 1);
   const recorded = results[0].record; assert.equal(await store.get('foreign-owner', recorded.id), undefined); assert.equal(await store.cas('foreign-owner', recorded.id, 0, { state: 'ready', writerStopped: true }), undefined);
   const races = await Promise.all([store.cas(row.owner, recorded.id, 0, { state: 'ready', writerStopped: true }), store.cas(row.owner, recorded.id, 0, { state: 'cleanup-pending', writerStopped: false })]); assert.equal(races.filter(Boolean).length, 1);
   // Open a genuinely separate connection after closing all prior connections.
   await pool.end();
   const reopened = postgres(url.toString(), { max: 2 });
   const restarted = createPostgresFileMetadata(drizzle(reopened));
   try { assert.equal((await restarted.byToken(row.owner, row.idempotencyKey))?.id, recorded.id);
   const current = await restarted.get(row.owner, recorded.id); assert(current); await restarted.cas(row.owner, recorded.id, current.revision, { state: 'removed', writerStopped: true });
   assert.equal((await restarted.reserve(row)).record.state, 'removed');
   // Runtime removal retains schema and durable receipts; migration rerun cannot delete them.
   await migrate(drizzle(reopened), { migrationsFolder: 'server/database/migrations' }); assert.equal((await reopened.unsafe('select count(*)::int as n from file_ui_files'))[0].n, 1); assert.deepEqual((await reopened.unsafe('select hash,created_at from drizzle.__drizzle_migrations order by id')), before);
   } finally { await reopened.end(); }
  } finally { await pool.end(); await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await rm(folder, { recursive: true, force: true }); }
 }
 console.info('File UI clean/upgrade migrations, frozen prior hashes, atomic ownership/CAS and durable restart/retained receipts passed.');
} finally { await admin.end(); }
