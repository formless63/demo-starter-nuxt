import { expect, test } from '@playwright/test'
import { verifyInternationalization } from '../../fixtures/internationalization-consumer/.fixture/browser'
test('internationalization hydrates and guards locale transitions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'warning' && /hydration/i.test(message.text())) errors.push(message.text()) })
  await page.goto('/i18n-test')
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true', { timeout: 30_000 })
  await verifyInternationalization(page)
  expect(errors).toEqual([])
})
