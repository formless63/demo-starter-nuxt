// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cacheableResponse, cachePrefix, eligibleNavigation, validBase, validPublicPath } from '../../packages/nuxt-pwa-offline/src/runtime/policy'

const safeURL = 'https://example.test/pwa-offline/offline.html'
function response(patch: Partial<Response> = {}): Response {
  return { status: 200, type: 'basic', redirected: false, url: safeURL, headers: new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }), ...patch } as Response
}
const request = (url: string, method = 'GET', mode = 'navigate') => ({ url, method, mode }) as Request

describe('PWA exact public-only cache policy', () => {
  it('accepts only canonical local bases and explicit non-private paths', () => {
    for (const base of ['/', '/demo/', '/nested/app/']) expect(validBase(base)).toBe(true)
    for (const base of ['https://example.test/', '//else/', '/x/../', '/x?y/', '/x#y/', '/x%2fy/', '/demo']) expect(validBase(base)).toBe(false)
    for (const path of ['pwa-test', 'public/help']) expect(validPublicPath(path)).toBe(true)
    for (const path of ['app/account', 'api/private', 'auth', 'uploads/x', '_server/action', '_build/file', '_nuxt/private', '../x', 'x?y', 'x#z', 'x%2fy', '/pwa-test', '']) expect(validPublicPath(path)).toBe(false)
  })

  it('rejects non-public, ambiguous, varied, redirected and unexpected responses', () => {
    expect(cacheableResponse(response(), safeURL, true)).toBe(true)
    for (const patch of [{ status: 401 }, { status: 500 }, { type: 'opaque' }, { redirected: true }, { url: 'https://evil.test/' }]) expect(cacheableResponse(response(patch as Partial<Response>), safeURL, true)).toBe(false)
    for (const control of ['', 'private', 'public, private', 'public, no-store', 'public, no-cache', 'x-public', 'public, public', 'public=0', 'note="x,public,z"']) {
      expect(cacheableResponse(response({ headers: new Headers({ 'content-type': 'text/html', 'cache-control': control }) }), safeURL, true)).toBe(false)
    }
    for (const vary of ['Cookie', 'Authorization', '*', 'Accept-Language', 'Cookie, Accept-Encoding']) {
      expect(cacheableResponse(response({ headers: new Headers({ 'content-type': 'text/html', 'cache-control': 'public, max-age=300', vary }) }), safeURL, true)).toBe(false)
    }
    expect(cacheableResponse(response({ headers: new Headers({ 'content-type': 'text/html', 'cache-control': 'public, max-age=300', vary: 'Accept-Encoding' }) }), safeURL, true)).toBe(true)
    expect(cacheableResponse(response({ headers: new Headers({ 'content-type': 'application/json', 'cache-control': 'public' }) }), safeURL, true)).toBe(false)
    for (const control of ['x-public, x-immutable', 'public, immutable, public', 'note="x,public,immutable,z"', 'public=0, immutable', 'public, immutable=0', 'public']) {
      expect(cacheableResponse(response({ headers: new Headers({ 'content-type': 'image/png', 'cache-control': control }) }), safeURL, false)).toBe(false)
    }
    expect(cacheableResponse(response({ headers: new Headers({ 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' }) }), safeURL, false)).toBe(true)
  })

  it('defaults to no navigation fallback and matches exact same-origin configured GET navigations', () => {
    const scope = new URL('https://example.test/demo/')
    const url = `${scope.href}pwa-test`
    expect(eligibleNavigation(request(url), scope, [])).toBe(false)
    expect(eligibleNavigation(request(url), scope, ['pwa-test'])).toBe(true)
    for (const candidate of [request(`${url}?q=private`), request('https://example.test/pwa-test'), request(url, 'POST'), request(url, 'GET', 'cors'), request('https://other.test/demo/pwa-test'), request(`${url}/child`)]) {
      expect(eligibleNavigation(candidate, scope, ['pwa-test'])).toBe(false)
    }
    expect(eligibleNavigation(request(`${scope.href}api/private`), scope, ['api/private'])).toBe(false)
    expect(cachePrefix('https://example.test/')).not.toBe(cachePrefix(scope.href))
  })
})
