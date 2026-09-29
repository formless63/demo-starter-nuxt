export default defineEventHandler(async () => ({
  id: await sendJob('fixture.echo', { message: 'fixture-api' }),
}))
