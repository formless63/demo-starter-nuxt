import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { invalidTypes } from '../../fixtures/notifications-consumer/.fixture/contract-vectors'
import { eq } from 'drizzle-orm'
import * as tables from '../../server/database/schema'

test('real session recipient isolation and post-commit ID-only hints over SSE and WebSocket', async ({ page, context, request }) => {
  test.setTimeout(60000)
  const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', { max: 3 })
  const db = drizzle(client)
  const recipientId = crypto.randomUUID(), foreignId = crypto.randomUUID(), token = crypto.randomUUID()
  const secret = process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  const name = process.env.PLAYWRIGHT_BASE_URL ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
  const value = `${token}.${signature}`
  const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
  const headers = { cookie: `${name}=${encodeURIComponent(value)}` }
  try {
    await db.insert(tables.user).values([{ id: recipientId, name: 'Private recipient', email: `${recipientId}@example.test` }, { id: foreignId, name: 'Foreign', email: `${foreignId}@example.test` }])
    await db.insert(tables.session).values({ id: crypto.randomUUID(), token, userId: recipientId, expiresAt: new Date(Date.now() + 60000) })
    const foreignNotificationId = crypto.randomUUID()
    await db.insert(tables.notification).values({ id: foreignNotificationId, recipientId: foreignId, type: 'fixture.foreign', title: 'Foreign private', body: 'Foreign body' })
    expect((await request.get('/api/notifications')).status()).toBe(401)
    expect((await request.get('/api/realtime/sse')).status()).toBe(401)
    expect((await request.get('/api/realtime/sse?token=private', { headers })).status()).toBe(401)
    expect((await request.patch(`/api/notifications/${foreignNotificationId}/read`, { headers, data: { read: true } })).status()).toBe(404)
    expect((await request.patch(`/api/notifications/${crypto.randomUUID()}/read`, { headers, data: { read: true } })).status()).toBe(404)
    await context.addCookies([{ name, value: encodeURIComponent(value), domain: new URL(base).hostname, path: '/', httpOnly: true, secure: Boolean(process.env.PLAYWRIGHT_BASE_URL) }])
    await page.goto('/api/health')
    await page.evaluate(async () => {
      const state = { sse: [] as unknown[], ws: [] as unknown[], source: new EventSource('/api/realtime/sse'), socket: new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/realtime/ws`) }
      Object.assign(window, { notificationTest: state })
      state.source.addEventListener('notifications.created', event => state.sse.push(JSON.parse((event as MessageEvent).data)))
      state.socket.onmessage = (event) => {
        if (event.data === '{"heartbeat":"ping"}') state.socket.send('{"heartbeat":"pong"}')
        else state.ws.push(JSON.parse(event.data))
      }
      await Promise.all([
        new Promise<void>((resolve, reject) => { state.source.onopen = () => resolve(); state.source.onerror = () => reject(new Error('SSE denied')) }),
        new Promise<void>((resolve, reject) => { state.socket.onopen = () => resolve(); state.socket.onerror = () => reject(new Error('WS denied')) }),
      ])
    })
    for (const type of invalidTypes) expect((await request.get(`/api/notifications?type=${encodeURIComponent(type)}`, { headers })).status()).toBe(400)
    const title = '  <tag> & Private title  '
    const created = await request.post('/api/notifications/demo', { headers, data: { title, body: 'Private body' } })
    expect(created.status()).toBe(201)
    const notification = await created.json() as { id: string }
    await expect.poll(() => page.evaluate(() => {
      const state = (window as unknown as { notificationTest: { sse: unknown[], ws: unknown[] } }).notificationTest
      return [state.sse.length, state.ws.length]
    })).toEqual([1, 1])
    const envelopes = await page.evaluate(() => {
      const state = (window as unknown as { notificationTest: { sse: unknown[], ws: unknown[] } }).notificationTest
      return [state.sse[0], state.ws[0]]
    })
    expect(envelopes[0]).toEqual(envelopes[1])
    expect(envelopes[0]).toMatchObject({ type: 'notifications.created', data: { notificationId: notification.id } })
    expect(Object.keys((envelopes[0] as { data: object }).data)).toEqual(['notificationId'])
    for (const privateValue of ['Private', recipientId, token]) expect(JSON.stringify(envelopes)).not.toContain(privateValue)
    const list = await (await request.get('/api/notifications', { headers })).json() as { items: Array<{ id: string, title: string, readAt: string | null }> }
    expect(list.items.map(row => row.id)).toEqual([notification.id])
    expect(list.items[0]!.title).toBe(title)
    for (const read of [true, true, false, false]) expect((await request.patch(`/api/notifications/${notification.id}/read`, { headers, data: { read } })).status()).toBe(200)
    const unread = await (await request.get('/api/notifications?unreadOnly=true', { headers })).json() as { items: unknown[] }
    expect(unread.items).toHaveLength(1)
    // A second connection sees no old hint: continuity comes from authoritative fetch.
    expect(await page.evaluate(async () => {
      const source = new EventSource('/api/realtime/sse')
      let hints = 0; source.addEventListener('notifications.created', () => hints++)
      await new Promise<void>(resolve => { source.onopen = () => resolve() })
      await new Promise(resolve => setTimeout(resolve, 200)); source.close()
      return hints
    })).toBe(0)
    await page.evaluate(() => {
      const state = (window as unknown as { notificationTest: { source: EventSource, socket: WebSocket } }).notificationTest
      state.source.close(); state.socket.close()
    })
  }
  finally {
    await page.close()
    await db.delete(tables.notification).where(eq(tables.notification.recipientId, recipientId))
    await db.delete(tables.notification).where(eq(tables.notification.recipientId, foreignId))
    await db.delete(tables.user).where(eq(tables.user.id, recipientId)); await db.delete(tables.user).where(eq(tables.user.id, foreignId))
    await client.end()
  }
})
