import { expect, type Page } from '@playwright/test'

// Cold Nuxt dev imports have a separate startup budget. Keep ordinary UI
// assertions at their default timeout once event handlers are attached.
export async function waitForHydration(page: Page) {
  await expect(page.locator('html'), 'Nuxt application finishes hydration')
    .toHaveAttribute('data-app-hydrated', 'true', { timeout: 30_000 })
}
