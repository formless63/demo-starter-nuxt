import { compose, startValkey } from '../fixtures/cache-consumer/.fixture/valkey'

const project = 'starter-cache-dev'
const port = process.env.CACHE_DEV_PORT || '6379'
if (Bun.argv[2] === 'valkey') {
  await startValkey(project, port)
  console.info('Local disposable Valkey is ready; set server-only CACHE_URL to the loopback address for your CACHE_DEV_PORT (default 6379).')
}
else if (Bun.argv[2] === 'down') {
  await compose(project, ['down', '--remove-orphans'], port)
  console.info('Local disposable Valkey stopped')
}
else throw new Error('Use cache:dev:valkey or cache:dev:down')
