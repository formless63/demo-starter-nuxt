import { getBuildInfo } from '@repo/nuxt-observability/server'

export default defineEventHandler(() => ({ status: 'ok', build: getBuildInfo() }))
