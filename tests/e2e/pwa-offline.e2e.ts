import { createHmac, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { publicAssets } from '../../packages/nuxt-pwa-offline/src/runtime/constants'
import { waitForHydration } from './hydration'

const production = !!process.env.PLAYWRIGHT_BASE_URL

test('PWA controls render safely and hydrate without automatic registration', async ({ page, request }) => {
  const response = await request.get('/pwa-test')
  expect(response.status()).toBe(200)
  const ssr = await response.text()
  expect(ssr).toMatch(/<link(?=[^>]*rel="manifest")(?=[^>]*href="\/manifest\.webmanifest")[^>]*>/u)
  expect(ssr).toMatch(/<button(?=[^>]*disabled)[^>]*>Enable offline notice<\/button>/u)
  expect(ssr).toMatch(/<button(?=[^>]*disabled)[^>]*>Install app<\/button>/u)
  expect(ssr).toContain('Public offline notice')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/pwa-test')
  await waitForHydration(page)
  await expect(page.locator('[data-pwa-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable offline notice' })).toBeEnabled()
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
  expect(await page.evaluate(() => caches.keys())).toEqual([])
  await page.getByLabel('Unsaved draft').fill('Preserve my café draft 🧭')
  await page.getByRole('button', { name: 'Hide offline controls' }).click()
  await page.getByRole('button', { name: 'Show offline controls' }).click()
  await expect(page.locator('[data-pwa-hydrated="true"]')).toBeVisible()
  await expect(page.getByLabel('Unsaved draft')).toHaveValue('Preserve my café draft 🧭')
  const synthetic = await page.evaluate(async () => {
    const install = [...document.querySelectorAll('button')].find(button => button.textContent === 'Install app')!
    const before = { disabled: install.disabled, status: document.querySelector('[role="status"]')?.textContent }
    window.dispatchEvent(new Event('beforeinstallprompt'))
    window.dispatchEvent(new Event('appinstalled'))
    await Promise.resolve()
    return { before, after: { disabled: install.disabled, status: document.querySelector('[role="status"]')?.textContent } }
  })
  expect(synthetic.after).toEqual(synthetic.before)
  // NuxtLink starts an asynchronous Vue Router transition. A click can finish
  // before its lazy route is committed; Back at that point leaves for about:blank.
  // Prove each destination and panel unmount before exercising browser history.
  const homeHeading = page.getByRole('heading', { name: 'A practical base for your next project.', exact: true })
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page).toHaveURL(/\/$/u)
  await expect(homeHeading).toBeVisible()
  await expect(page.locator('[data-pwa-hydrated]')).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(/\/pwa-test$/u)
  await expect(page.locator('[data-pwa-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable offline notice' })).toBeEnabled()
  await page.goForward()
  await expect(page).toHaveURL(/\/$/u)
  await expect(homeHeading).toBeVisible()
  await expect(page.locator('[data-pwa-hydrated]')).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(/\/pwa-test$/u)
  await expect(page.locator('[data-pwa-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable offline notice' })).toBeEnabled()
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
  expect(errors).toEqual([])
})

test('production PWA never retains real authenticated API or SSR content across logout', async ({ page, context, baseURL }) => {
  // Native production workers are deliberately disabled in Nuxt dev. This test
  // is mandatory in the existing production E2E run, using the same real app.
  test.skip(!production, 'Native service workers are emitted only by the production build')
  test.setTimeout(90000)
  const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/nuxt_starter', { max: 1 })
  const owner = `pwa-${randomUUID()}`
  const token = randomUUID()
  const project = randomUUID()
  const privateName = `Private offline exclusion ${randomUUID()}`
  const secret = process.env.NUXT_AUTH_SECRET || 'e2e-secret-that-is-at-least-thirty-two-chars'
  const encoded = encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`)
  try {
    await sql`insert into "user"(id,name,email) values(${owner},${owner},${`${owner}@example.test`})`
    await sql`insert into session(id,user_id,token,expires_at) values(${randomUUID()},${owner},${token},now()+interval '1 hour')`
    await sql`insert into project(id,owner_id,name) values(${project},${owner},${privateName})`
    await context.addCookies([
      { name: 'better-auth.session_token', value: encoded, domain: new URL(baseURL!).hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
      { name: '__Secure-better-auth.session_token', value: encoded, domain: new URL(baseURL!).hostname, path: '/', httpOnly: true, sameSite: 'Lax', secure: true },
    ])
    await page.goto('/pwa-test')
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Enable offline notice' }).click()
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 30000 }).toBe(true)
    await page.reload()
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30000 })
    const api = await page.evaluate(async () => {
      const response = await fetch('/api/projects')
      return { status: response.status, body: await response.text() }
    })
    expect(api.status).toBe(200)
    expect(api.body).toContain(privateName)
    const ssr = await page.goto('/app/projects')
    expect(ssr?.status()).toBe(200)
    expect(await ssr!.text()).toContain(privateName)
    await waitForHydration(page)
    await expect(page.getByText(privateName, { exact: true })).toBeVisible()
    const cached = await page.evaluate(async () => {
      const results: { url: string, body: string }[] = []
      for (const key of await caches.keys()) for (const entry of await (await caches.open(key)).keys()) {
        results.push({ url: entry.url, body: await (await (await caches.open(key)).match(entry))!.text() })
      }
      return results
    })
    expect(cached.map(entry => new URL(entry.url).pathname).sort()).toEqual(publicAssets.map(path => `/${path}`).sort())
    expect(JSON.stringify(cached)).not.toContain(privateName)
    expect(JSON.stringify(cached)).not.toContain(token)
    await page.getByRole('button', { name: 'Logout', exact: true }).click()
    await expect(page).toHaveURL(/\/$/u)
    expect(await page.evaluate(async () => (await fetch('/api/projects')).status)).toBe(401)
    const afterLogout = await page.goto('/app/projects')
    expect(await afterLogout!.text()).not.toContain(privateName)
    await expect(page).not.toHaveURL(/\/app\/projects$/u)
    await page.goto('/pwa-test')
    await context.setOffline(true)
    await expect(page.goto('/app/projects')).rejects.toThrow()
    await page.goto('/pwa-test')
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible()
    expect(await page.locator('body').textContent()).not.toContain(privateName)
    expect(await page.locator('body').textContent()).not.toContain(token)
  }
  finally {
    await context.setOffline(false)
    await sql`delete from project where id=${project}`
    await sql`delete from session where user_id=${owner}`
    await sql`delete from "user" where id=${owner}`
    await sql.end()
  }
})
