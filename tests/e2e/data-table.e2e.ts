import { expect, test } from '@playwright/test'
import { waitForHydration } from './hydration'

test('data table renders accessibly and preserves stable row identity', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/data-table-test')
  await expect(page.getByRole('table')).toBeVisible()
  await waitForHydration(page)
  await expect(page.getByRole('row')).toHaveCount(3)
  await expect(page.getByRole('navigation', { name: 'Table pagination' })).toContainText('Page 1')
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('row')).toHaveCount(2)
  await expect(page.getByRole('navigation', { name: 'Table pagination' })).toContainText('Page 2')
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('25')
  await expect(page.getByRole('row')).toHaveCount(4)
  await expect(page.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('25')
  await expect(page.getByRole('navigation', { name: 'Table pagination' })).toContainText('Page 1')
  await page.getByRole('textbox', { name: 'Filter rows' }).fill('Alpha')
  await expect(page.getByRole('cell', { name: 'Beta' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'name column' }).uncheck()
  await expect(page.getByRole('columnheader', { name: 'Name' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Show name column' }).check()
  await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Filter rows' }).fill('')
  await page.getByRole('checkbox', { name: 'Select row a' }).check()
  await expect(page.getByRole('checkbox', { name: 'Select row a' })).toBeChecked()
  await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('25')
  await page.getByTestId('replace').click()
  await expect(page.getByRole('checkbox', { name: 'Select row a' })).toBeChecked()
  const sort = page.getByRole('button', { name: 'Sort by Name' })
  await sort.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('cell').nth(1)).toHaveText('Alpha')
  await sort.click()
  await expect(page.getByRole('cell').nth(1)).toHaveText('Gamma')
  await page.getByTestId('replace').click()
  await expect(page.getByRole('cell', { name: 'Alpha' })).toBeVisible()
  await page.getByTestId('reject').click()
  await page.getByRole('textbox', { name: 'Filter rows' }).fill('Gamma')
  await expect(page.getByRole('cell', { name: 'Alpha' })).toBeVisible()
  await page.getByTestId('reject').click()
  await page.getByTestId('manual').click()
  await page.getByRole('textbox', { name: 'Filter rows' }).fill('Beta')
  await expect(page.getByRole('cell', { name: 'Alpha' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
  await page.getByTestId('manual').click()
  await expect(page.getByRole('cell', { name: 'Alpha' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Beta' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByTestId('manual').click()
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
  await page.getByTestId('loading').click(); await expect(page.getByRole('status')).toContainText('Loading')
  await page.getByTestId('loading').click(); await page.getByTestId('error').click(); await expect(page.getByRole('alert')).toContainText('Unable')
  expect(errors).toEqual([])
})

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  const snapshot = await page.evaluate(() => ({
    hydrated: document.documentElement.getAttribute('data-app-hydrated'),
    stages: document.documentElement.dataset.nuxtE2eStages,
    ready: document.readyState,
    rows: document.querySelectorAll('tbody tr').length,
    pagination: document.querySelector('nav[aria-label="Table pagination"]')?.textContent,
    controls: [...document.querySelectorAll('nav button')].map(button => ({ text: button.textContent, disabled: (button as HTMLButtonElement).disabled })),
  })).catch(() => null)
  await testInfo.attach('data-table-readiness', { contentType: 'application/json', body: JSON.stringify(snapshot) })
})
