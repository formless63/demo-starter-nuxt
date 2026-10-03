import { rm } from 'node:fs/promises'
import { stateDirectory, statePath } from './harness'

await rm(stateDirectory, { recursive: true, force: true })
await rm(statePath, { force: true })
