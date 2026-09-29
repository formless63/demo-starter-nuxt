import { defineJobRegistry } from '@wicaso/nuxt-jobs/server'
import { fixtureEchoJob } from './tasks/fixture-echo'

export const jobRegistry = defineJobRegistry(fixtureEchoJob)
