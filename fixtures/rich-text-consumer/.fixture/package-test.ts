import { strict as assert } from 'node:assert'
import { chromium, expect } from '@playwright/test'
import { parseRichTextDocument } from '@repo/nuxt-rich-text/runtime'
import { verifyRichText } from './browser-checks'
for (const runtime of ['bun', 'node']) {
 const child = Bun.spawn([runtime, '.fixture/transport.ts'], { stdout: 'inherit', stderr: 'inherit' }); assert.equal(await child.exited, 0, 'Canonical rich text survives pinned Nuxt payload serialization')
}
assert.throws(() => parseRichTextDocument({ type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] }))
const port = 4328
const server = Bun.spawn(['bun', 'run', 'start'], { env: { ...Bun.env, PORT: String(port) }, stdout: 'ignore', stderr: 'inherit' })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
 let response: Response | undefined
 for (let i = 0; i < 100; i++) { try { response = await fetch(`http://127.0.0.1:${port}`) } catch { /* startup */ }; if (response) break; await Bun.sleep(200) }
 assert.ok(response); assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /charset=utf-8/i)
 const html = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer()); assert.match(html, /<meta charset="utf-8"/i); assert.match(html, /Hello rich text/); assert.match(html, /Loading editor…/); assert.doesNotMatch(html, /contenteditable="true"/)
 if (process.env.CI) { const install = Bun.spawn(['bun', 'x', 'playwright', 'install', '--with-deps', 'chromium'], { stdout: 'inherit', stderr: 'inherit' }); assert.equal(await install.exited, 0) }
 browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); const errors: string[] = []
 page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /hydration/i.test(m.text()))) errors.push(m.text()) })
 await page.goto(`http://127.0.0.1:${port}`); await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true', { timeout: 30_000 }); await verifyRichText(page); assert.deepEqual(errors, [])
} finally { await browser?.close(); server.kill(); await server.exited }
