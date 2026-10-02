import { expect, test } from '@playwright/test'

test.describe('charts visualization', () => {
  test('enhances SSR fallback and supports kinds, replacement, accessibility, motion, and cleanup', async ({ page }) => {
    const browserErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', error => browserErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.goto('/charts')
    await expect(page.getByRole('heading', { name: 'Revenue' })).toBeVisible()
    await expect(page.locator('#primary-chart table')).toBeVisible()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()
    await expect(page.locator('#primary-chart [aria-describedby="primary-chart-description"]')).toHaveCount(1)
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
    await expect(page.getByRole('status')).toHaveText('Loading chart data…')
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
    await expect(page.getByRole('status')).toHaveText('Loading chart data…')
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').animation).toBe(false)
    const initialWidth = await page.locator('[data-echarts-state]').evaluate(node => JSON.parse(node.textContent ?? '{}').width)
    await page.setViewportSize({ width: 700, height: 800 })
    await expect.poll(async () => JSON.parse(await page.locator('[data-echarts-state]').textContent() ?? '{}').width).not.toBe(initialWidth)
    expect(browserErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
