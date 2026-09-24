import { test,expect } from '@playwright/test'
test('landing and route guard',async({page})=>{await page.goto('/');await expect(page.getByRole('heading',{name:/practical base/i})).toBeVisible();await page.goto('/app/projects');await expect(page).toHaveURL(/\/?redirect=/)})
