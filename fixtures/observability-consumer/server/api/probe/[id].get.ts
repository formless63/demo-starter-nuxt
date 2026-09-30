import { getLogger, getRequestId, withSpan, withLogContext } from '@repo/nuxt-observability/server'

export default defineEventHandler(async (event) => {
  // Interleave concurrent requests. No request data is logged by default or by this handler.
  await new Promise(resolve => setTimeout(resolve, getRouterParam(event, 'id') === 'slow' ? 60 : 5))
  return withLogContext({ component: 'fixture' }, () => withSpan('fixture.operation', async () => {
    await Promise.resolve()
    getLogger().info({ authorization: 'AUTH_SECRET', Cookie: 'COOKIE_SECRET', 'set-cookie': 'SET_COOKIE_SECRET',
      'x-api-key': 'KEY_SECRET', nested: { password: 'PASSWORD_SECRET', secret: 'SECRET_SECRET', token: 'TOKEN_SECRET',
        accessToken: 'ACCESS_SECRET', refreshToken: 'REFRESH_SECRET', clientSecret: 'CLIENT_SECRET',
        privateNote: 'PRIVATE_SECRET', databaseUrl: 'postgres://user:DB_SECRET@localhost/database' },
      body: { value: 'BODY_SECRET' }, headers: { arbitrary: 'HEADER_SECRET' }, payload: 'PAYLOAD_SECRET',
      session: { value: 'SESSION_SECRET' }, user: { value: 'USER_SECRET' },
    }, 'fixture.nested')
    getLogger().child({ token: 'CHILD_SECRET', component: 'child' }).info('fixture.child')
    return { requestId: getRequestId() }
  }))
})
