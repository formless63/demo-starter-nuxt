export default defineEventHandler(async () => {
  const cache = getCache()
  await cache.checkCache()
  await cache.set('fixture/auto-import', 'ok')
  const result = await cache.get('fixture/auto-import')
  await cache.delete('fixture/auto-import')
  return { ok: result?.toString() === 'ok' }
})
