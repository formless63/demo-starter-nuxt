import { expect, test } from '@playwright/test'

test('renders the landing page and protects the application area', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /practical base/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()

  const response = await page.request.get('/app/projects', { maxRedirects: 0 })
  const redirectURL = new URL(response.headers().location!, page.url())

  expect(response.status()).toBe(302)
  expect(redirectURL.pathname).toBe('/')
  expect(redirectURL.searchParams.get('redirect')).toBe('/app/projects')
})
