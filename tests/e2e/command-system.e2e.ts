import { expect, test } from '@playwright/test'
import { waitForHydration } from './hydration'

test('root Command module hydrates, filters, restores focus and navigates', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/hydration/i.test(message.text())) errors.push(message.text()) })
  await page.goto('/commands')
  const trigger = page.getByRole('button', { name: 'Open command menu', exact: true })
  await expect(trigger).toBeVisible()
  await waitForHydration(page)
  await trigger.focus()
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('combobox')).toBeFocused()
  await page.getByRole('combobox').fill('work')
  await expect(page.getByRole('option')).toHaveText('Open projects')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole('combobox').fill('start')
  await page.getByRole('combobox').press('Enter')
  await expect(page).toHaveURL('/')
  expect(errors).toEqual([])
})
