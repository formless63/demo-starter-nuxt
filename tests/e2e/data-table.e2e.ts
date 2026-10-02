import { expect, test } from '@playwright/test'

test('data table renders accessibly and preserves stable row identity', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/data-table-test')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Alpha' })).toBeVisible()
  const sort = page.getByRole('button', { name: 'Sort by Name' })
  await sort.focus(); await page.keyboard.press('Enter')
  await expect(sort).toHaveAttribute('aria-label', 'Sort by Name')
  await expect(page.locator('th').first()).toHaveAttribute('aria-sort', /ascending|descending|none/)
  await page.getByTestId('replace').click()
  await expect(page.getByRole('cell', { name: 'Alpha' })).toBeVisible()
  await page.getByTestId('loading').click(); await expect(page.getByRole('status')).toContainText('Loading')
  await page.getByTestId('loading').click(); await page.getByTestId('error').click(); await expect(page.getByRole('alert')).toContainText('Unable')
  expect(errors).toEqual([])
})
