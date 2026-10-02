import { expect, test } from '@playwright/test'
import { waitForHydration } from './hydration'

test('Markdown reference is safe SSR with native Vue clipboard behavior', async ({ page }) => {
  await page.goto('/markdown')
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'Markdown reference' })).toBeVisible()
  await expect(page.locator('.markdown-content img')).toHaveCount(0)
  await expect(page.locator('.markdown-content a[href^="javascript:"]')).toHaveCount(0)
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { document.documentElement.dataset.copied = text } } }) })
  await expect(page.getByRole('button', { name: 'Copy typescript code' })).toBeEnabled()
  await page.getByRole('button', { name: 'Copy typescript code' }).click()
  await expect(page.locator('output').first()).toHaveText('Copied')
  await expect(page.locator('html')).toHaveAttribute('data-copied', 'const greeting = "<script>"\n')
})
