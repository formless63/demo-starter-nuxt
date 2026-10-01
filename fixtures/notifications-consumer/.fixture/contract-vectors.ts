import assert from 'node:assert/strict'
import type { NotificationInput, NotificationQuery } from '@repo/nuxt-notifications/server'

export const validTypes = ['test.created', 'a.b', 'test_name.event-2', 'a.b.c', `a.${'b'.repeat(126)}`]
export const invalidTypes = ['', ' ', 'unqualified', '.test', 'test.', 'test..created', 'Test.created', 'test.Created', 'test.1', ' test.created', 'test.created ', `a.${'b'.repeat(127)}`]
export const validTitles = ['<tag>', '  <tag> & text  ', 'x'.repeat(200), '😀'.repeat(100)]
export const invalidTitles = ['', '   ', 'x'.repeat(201), '😀'.repeat(101), '\u0000', '\ud800']
export const validMetadata = [{ ' ': 1 }, { '  reference  ': 'exact', ['x'.repeat(64)]: '<tag>' }]

interface Contract {
  appendNotification: (db: never, input: NotificationInput) => Promise<unknown>
  queryNotifications: (db: never, recipientId: string, query?: NotificationQuery) => Promise<unknown>
}
/** Shared source, distributable and packed-runtime validation vectors. */
export async function verifyNotificationContract(api: Contract) {
  let inserts = 0, selects = 0, saved: NotificationInput | undefined
  const reader = { from: () => reader, where: () => reader, orderBy: () => reader, limit: async () => [] }
  const db = {
    insert: () => { inserts++; return { values: (value: NotificationInput) => { saved = value; return { returning: async () => [value] } } } },
    select: () => { selects++; return reader },
  } as never
  const input = { recipientId: 'owner', type: 'test.created', title: 'Title', body: 'Body' }
  for (const type of invalidTypes) {
    // Creation may construct an insert builder before validation; no values are written.
    saved = undefined
    await assert.rejects(api.appendNotification(db, { ...input, type }), { code: 'invalid-input' })
    assert.equal(saved, undefined)
    const before = selects
    await assert.rejects(api.queryNotifications(db, 'owner', { type }), { code: 'invalid-input' })
    assert.equal(selects, before)
  }
  for (const type of validTypes) {
    await api.appendNotification(db, { ...input, type }); assert.equal(saved!.type, type)
    await api.queryNotifications(db, 'owner', { type })
  }
  await api.queryNotifications(db, 'owner', { type: undefined })
  for (const title of validTitles) {
    await api.appendNotification(db, { ...input, title }); assert.equal(saved!.title, title)
  }
  for (const title of invalidTitles) await assert.rejects(api.appendNotification(db, { ...input, title }), { code: 'invalid-input' })
  for (const metadata of validMetadata) {
    await api.appendNotification(db, { ...input, metadata }); assert.deepEqual(saved!.metadata, metadata)
  }
  assert(inserts > 0)
}
