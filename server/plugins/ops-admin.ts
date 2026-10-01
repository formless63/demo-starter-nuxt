import { closeOpsJobs } from '../ops/jobs'
export default defineNitroPlugin((nitro) => { nitro.hooks.hook('close', closeOpsJobs) })
