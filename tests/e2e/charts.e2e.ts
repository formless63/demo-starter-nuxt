import { expect, test } from '@playwright/test'

test.describe('charts visualization', () => {
  test('enhances SSR fallback and supports kinds, replacement, accessibility, motion, and cleanup', async ({ page }) => {
    const browserErrors: string[] = []
    page.on('pageerror', error => browserErrors.push(error.message))
    await page.goto('/charts')
    await expect(page.getByRole('heading', { name: 'Revenue' })).toBeVisible()
    await expect(page.locator('#primary-chart table')).toBeVisible()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()
    await expect(page.locator('#primary-chart [aria-describedby="primary-chart-description"]')).toHaveCount(1)
    await expect(page.locator('figure[aria-labelledby]')).toHaveCount(2)
    const ids = await page.locator('figure[aria-labelledby]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-labelledby')))
    expect(new Set(ids).size).toBe(2)
    await expect(page.locator('#primary-chart [data-chart-kind="line"]')).toHaveAttribute('data-chart-series', '[[10,15]]')

    await page.getByRole('button', { name: 'bar', exact: true }).click()
    await expect(page.locator('#primary-chart [data-chart-kind="bar"]')).toBeVisible()
    await page.getByRole('button', { name: 'area', exact: true }).click()
    await expect(page.locator('#primary-chart [data-chart-kind="area"]')).toBeVisible()
    const update = page.getByRole('button', { name: 'Replace data' }).click()
    await expect(page.getByRole('status')).toHaveText('Loading chart data…')
    await update
    await expect(page.locator('#primary-chart [data-chart-series="[[12,18,9]]"]')).toBeVisible()

    await page.getByRole('button', { name: 'Toggle empty' }).click()
    await expect(page.locator('#primary-chart')).toContainText('No chart data available.')
    await page.getByRole('button', { name: 'Toggle mount' }).click()
    await expect(page.locator('#primary-chart')).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle mount' }).click()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Replace data' }).click()
    await expect(page.locator('#primary-chart [data-chart-animation="false"]')).toBeVisible()
    const box = await page.locator('#primary-chart .charts-visualization__canvas').boundingBox()
    expect(box?.height).toBeGreaterThan(0)
    expect(browserErrors).toEqual([])
  })
})
