import { defineJobRegistry } from '@repo/nuxt-jobs/server'
// The app is deliberately backendless; explicit fixture operations register transfer jobs.
export const jobRegistry = defineJobRegistry()
