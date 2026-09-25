export function validateRuntimeConfig() {
  const config = useRuntimeConfig()
  const missing: string[] = []
  const databaseUrl = config.databaseUrl || process.env.DATABASE_URL

  if (!databaseUrl) missing.push('DATABASE_URL')
  if (!config.authSecret || config.authSecret.length < 32) missing.push('NUXT_AUTH_SECRET (32+ characters)')
  if (!config.public.appBaseUrl) missing.push('NUXT_PUBLIC_APP_BASE_URL')

  let baseUrl: URL | undefined
  if (config.public.appBaseUrl) {
    try {
      baseUrl = new URL(config.public.appBaseUrl)
    }
    catch {
      missing.push('NUXT_PUBLIC_APP_BASE_URL (valid absolute URL)')
    }
  }

  if (process.env.NODE_ENV === 'production' && baseUrl?.hostname === 'localhost') {
    missing.push('NUXT_PUBLIC_APP_BASE_URL (must not use localhost in production)')
  }

  if (missing.length) {
    throw new Error(`Invalid server configuration: ${missing.join(', ')}`)
  }
}
