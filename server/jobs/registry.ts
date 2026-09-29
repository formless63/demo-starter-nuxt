import { defineJobRegistry } from '../../modules/jobs/runtime/server/registry'
import { starterEchoJob } from './tasks/starter-echo'

export const jobRegistry = defineJobRegistry(starterEchoJob)
