import { defineJobRegistry } from '@wicaso/nuxt-jobs/server'
import { starterEchoJob } from './tasks/starter-echo'

export const jobRegistry = defineJobRegistry(starterEchoJob)
