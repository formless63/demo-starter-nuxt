import { compose, startProvider } from '../fixtures/storage-consumer/.fixture/providers'

const project = 'starter-storage-dev'
const provider = Bun.argv[2]
if (provider === 'down') {
  // No --volumes: operator data is retained.
  await compose(project, ['--profile', 'rustfs', '--profile', 'garage', '--profile', 'garage-ui', 'down', '--remove-orphans'], { GARAGE_UI_AUTH: 'unused:unused' })
}
else if (provider === 'rustfs' || provider === 'garage') {
  const backend = await startProvider(provider, project)
  backend.storage.close()
  console.info(`Local ${provider} bootstrapped. Set STORAGE_BUCKET=${backend.config.bucket}, STORAGE_REGION=${backend.config.region}, STORAGE_ENDPOINT=${backend.config.endpoint}; credentials match the development Compose settings. No application environment file was overwritten.`)
}
else throw new Error('Usage: storage-dev.ts <rustfs|garage|down>')
