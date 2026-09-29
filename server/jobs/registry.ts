import { defineJobRegistry } from '@repo/nuxt-jobs/server'
import { starterEchoJob } from './tasks/starter-echo'

export const jobRegistry = defineJobRegistry(starterEchoJob)
