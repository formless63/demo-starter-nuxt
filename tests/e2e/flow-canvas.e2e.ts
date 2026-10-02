import { test } from '@playwright/test'
import { waitForHydration } from './hydration'
import { checkFlowCanvas } from '../../fixtures/flow-canvas-consumer/.fixture/browser'

test('Flow reference preserves controlled native state, isolation and async persistence', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/flow-test')
  await waitForHydration(page)
  await checkFlowCanvas(page)
})
