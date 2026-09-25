import { expect, test } from '@playwright/test'

test('renders the landing page and protects the application area', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /practical base/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()

  await page.goto('/app/projects')
  await page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('redirect') === '/app/projects')
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/app/projects')
  await expect(page.getByRole('heading', { name: /practical base/i })).toBeVisible()
})
