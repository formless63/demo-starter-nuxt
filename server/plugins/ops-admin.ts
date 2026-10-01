import { closeOpsJobs } from '../ops/jobs'
import { closeOpsStorage } from '../ops/storage'
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', async () => { closeOpsStorage(); await closeOpsJobs() })
})
