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
    const initialOption = await page.locator('#primary-chart .charts-visualization__canvas').evaluate((host: HTMLElement & { __echarts_instance__?: { getOption: () => { series?: Array<{ type?: string; data?: unknown[] }>; animation?: boolean } } }) => {
      const option = host.__echarts_instance__?.getOption()
      return { type: option?.series?.[0]?.type, data: option?.series?.[0]?.data }
    })
    expect(initialOption).toEqual({ type: 'line', data: [10, 15] })

    await page.getByRole('button', { name: 'bar', exact: true }).click()
    await expect.poll(() => page.locator('#primary-chart .charts-visualization__canvas').evaluate((host: HTMLElement & { __echarts_instance__?: { getOption: () => { series?: Array<{ type?: string }> } } }) => host.__echarts_instance__?.getOption().series?.[0]?.type)).toBe('bar')
    await page.getByRole('button', { name: 'area', exact: true }).click()
    await expect.poll(() => page.locator('#primary-chart .charts-visualization__canvas').evaluate((host: HTMLElement & { __echarts_instance__?: { getOption: () => { series?: Array<{ type?: string; areaStyle?: unknown }> } } }) => host.__echarts_instance__?.getOption().series?.[0]?.areaStyle !== undefined)).toBe(true)
    await page.getByRole('button', { name: 'Start update' }).click()
    await expect(page.getByRole('status')).toHaveText('Loading chart data…')
    await page.getByRole('button', { name: 'Apply update' }).click()
    await expect.poll(() => page.locator('#primary-chart .charts-visualization__canvas').evaluate((host: HTMLElement & { __echarts_instance__?: { getOption: () => { series?: Array<{ data?: unknown[] }> } } }) => host.__echarts_instance__?.getOption().series?.[0]?.data)).toEqual([12, 18, 9])

    await page.getByRole('button', { name: 'Toggle empty' }).click()
    await expect(page.locator('#primary-chart')).toContainText('No chart data available.')
    await page.getByRole('button', { name: 'Toggle mount' }).click()
    await expect(page.locator('#primary-chart')).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle mount' }).click()
    await expect(page.locator('#primary-chart canvas')).toBeVisible()

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Start update' }).click()
    await expect(page.getByRole('status')).toHaveText('Loading chart data…')
    const animation = await page.locator('#primary-chart .charts-visualization__canvas').evaluate((host: HTMLElement & { __echarts_instance__?: { getOption: () => { animation?: boolean } } }) => host.__echarts_instance__?.getOption().animation)
    expect(animation).toBe(false)
    const initialWidth = await page.locator('#primary-chart .charts-visualization__canvas').evaluate((host: HTMLElement & { __echarts_instance__?: { getWidth: () => number } }) => host.__echarts_instance__?.getWidth())
    await page.setViewportSize({ width: 700, height: 800 })
    await expect.poll(() => page.locator('#primary-chart .charts-visualization__canvas').evaluate((host: HTMLElement & { __echarts_instance__?: { getWidth: () => number } }) => host.__echarts_instance__?.getWidth())).not.toBe(initialWidth)
    expect(browserErrors).toEqual([])
  })
})
