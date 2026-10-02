import { expect, test } from '@playwright/test'
import { waitForHydration } from './hydration'
import { verifyRichText } from '../../fixtures/rich-text-consumer/.fixture/browser-checks'
test('rich text SSR, hydration and real controlled editing', async ({ page, request }) => {
  const response = await request.get('/rich-text-test')
  expect(response.headers()['content-type']).toMatch(/charset=utf-8/i)
  const html = (await response.body()).toString('utf8')
  expect(html).toContain('Loading editor…'); expect(html).toMatch(/<meta charset="utf-8"/i)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /hydration/i.test(m.text()))) errors.push(m.text()) })
  await page.goto('/rich-text-test'); await waitForHydration(page); await verifyRichText(page); expect(errors).toEqual([])
})
