import { expect, test } from '@playwright/test'

test('renders the landing page and protects the application area', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /practical base/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()

  await page.evaluate(() => window.location.assign('/app/projects'))
  await page.waitForURL(/\?redirect=\/app\/projects/)
  await expect(page).toHaveURL(/\?redirect=\/app\/projects/)
  await expect(page.getByRole('heading', { name: /practical base/i })).toBeVisible()
})
