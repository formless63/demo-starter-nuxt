import { waitForHydration } from './hydration'
import { expect, test } from '@playwright/test'
import { browserDiagnostics } from './browser-diagnostics'

test('renders the landing page and protects the application area', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const diagnostics = browserDiagnostics(page)
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /practical base/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()
    await waitForHydration(page)

    const response = await page.request.get('/app/projects', { maxRedirects: 0 })
    const redirectURL = new URL(response.headers().location!, page.url())

    expect(response.status()).toBe(302)
    expect(redirectURL.pathname).toBe('/')
    expect(redirectURL.searchParams.get('redirect')).toBe('/app/projects')
  }
  catch (error) {
    const report = await diagnostics()
    console.info(`[landing-readiness] ${JSON.stringify(report)}`)
    await testInfo.attach('landing-readiness', { contentType: 'application/json', body: JSON.stringify(report) })
    throw error
  }

})
