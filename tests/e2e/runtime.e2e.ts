import { expect, test } from '@playwright/test'

test('root health and API surface boot without optional transport backends', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ status: 'ok' })
  const openapi = await request.get('/api/openapi.json')
  expect(openapi.status()).toBe(200)
  const document = await openapi.json()
  expect(document.openapi).toBe('3.1.1')
  expect(document.paths['/api/v1/projects']).toHaveProperty('post')
  expect((await request.get('/docs/api')).status()).toBe(200)
  expect((await request.get('/api/v1/projects')).status()).toBe(401)
})
