import { defineJobRegistry } from '@repo/nuxt-jobs/server'
// Applications explicitly compose provider jobs after supplying database/auth policies.
export const jobRegistry = defineJobRegistry()
