import { expect, test } from '@playwright/test'

test.describe('charts visualization', () => {
  test('enhances SSR fallback and supports kinds, replacement, accessibility, motion, and cleanup', async ({ page }, testInfo) => {
    const browserErrors: string[] = []
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const sanitize = (value: string) => { try { return new URL(value).pathname } catch { return value.replace(/[?].*$/u, '') } }
    const record = (kind: string, value: string) => {
      const body = Buffer.from(JSON.stringify({ kind, value, url: sanitize(page.url()) }, null, 2))
      void testInfo.attach(`charts-${kind}-${testInfo.attachments.length}`, { contentType: 'application/json', body })
    }
    page.on('pageerror', error => { const value = error.stack || error.message; browserErrors.push(value); record('pageerror', value) })
    page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); record('console-error', message.text()) } })
    page.on('requestfailed', request => { const value = `${request.method()} ${sanitize(request.url())} :: ${request.failure()?.errorText || 'unknown'}`; failedRequests.push(value); record('requestfailed', value) })
    const attachDiagnostics = async () => {
      await testInfo.attach('browser-diagnostics', {
        contentType: 'application/json',
        body: JSON.stringify({
          url: sanitize(page.url()),
          pageErrors: browserErrors,
          consoleErrors,
          requestFailures: failedRequests,
          state: await page.locator('[data-echarts-state]').textContent(),
          html: (await page.content()).slice(0, 100_000),
        }, null, 2),
      })
    }
    await page.goto('/charts')
    await expect(page.getByRole('heading', { name: 'Revenue' })).toBeVisible()
    await expect(page.locator('#primary-chart table')).toBeVisible()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()
    await expect(page.locator('#primary-chart[aria-describedby="primary-chart-description"]')).toHaveCount(1)
    await expect(page.locator('figure[aria-labelledby]')).toHaveCount(2)
    const ids = await page.locator('figure[aria-labelledby]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-labelledby')))
    expect(new Set(ids).size).toBe(2)
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').type).toBe('line')
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').data).toEqual([10, 15])

    await page.getByRole('button', { name: 'bar', exact: true }).click()
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').type).toBe('bar')
    await page.getByRole('button', { name: 'area', exact: true }).click()
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').area).toBe(true)
    await page.getByRole('button', { name: 'Start update' }).click()
    await expect(page.locator('p[role="status"]').filter({ hasText: 'Loading chart data…' })).toHaveText('Loading chart data…')
    await page.getByRole('button', { name: 'Apply update' }).click()
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').data).toEqual([12, 18, 9])

    await page.getByRole('button', { name: 'Toggle empty' }).click()
    await expect(page.locator('#primary-chart')).toContainText('No chart data available.')
    await page.getByRole('button', { name: 'Toggle mount' }).click()
    await expect(page.locator('#primary-chart')).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle mount' }).click()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Start update' }).click()
    await expect(page.locator('p[role="status"]').filter({ hasText: 'Loading chart data…' })).toHaveText('Loading chart data…')
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').animation).toBe(false)
    const initialWidth = await page.locator('[data-echarts-state]').evaluate(node => JSON.parse(node.textContent ?? '{}').width)
    await page.setViewportSize({ width: 700, height: 800 })
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').width).not.toBe(initialWidth)
    expect(browserErrors).toEqual([])
    expect(consoleErrors).toEqual([])
    await attachDiagnostics()
  })
})
