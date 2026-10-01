import { defineFeatureFlags } from '@repo/nuxt-feature-flags/server'
export const applicationFlags = defineFeatureFlags()
export const clientFlagAllowlist = Object.freeze(['beta.dashboard'] as const)
