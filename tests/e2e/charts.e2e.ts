import { expect, test } from '@playwright/test'

test.describe('charts visualization', () => {
  test('enhances SSR fallback and supports kinds, replacement, accessibility, motion, and cleanup', async ({ page }) => {
    await page.goto('/charts')
    await expect(page.getByRole('heading', { name: 'Revenue' })).toBeVisible()
    await expect(page.locator('#primary-chart table')).toBeVisible()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()
    await expect(page.locator('#primary-chart [aria-describedby="primary-chart-description"]')).toHaveCount(1)
    await expect(page.locator('#secondary-chart[aria-labelledby="secondary-chart-title"]')).toHaveCount(1)

    await page.getByRole('button', { name: 'bar', exact: true }).click()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()
    await page.getByRole('button', { name: 'area', exact: true }).click()
    await page.getByRole('button', { name: 'Replace data' }).click()
    await expect(page.locator('#primary-chart tbody tr')).toHaveCount(3)

    await page.getByRole('button', { name: 'Toggle empty' }).click()
    await expect(page.locator('#primary-chart tbody tr')).toHaveCount(3)
    await page.getByRole('button', { name: 'Toggle mount' }).click()
    await expect(page.locator('#primary-chart')).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle mount' }).click()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Replace data' }).click()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()
  })
})
