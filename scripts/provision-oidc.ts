import { chmod, readFile, writeFile } from 'node:fs/promises'

type PocketIdClient = {
  id: string
  name: string
  description: string
  callbackURLs: string[]
  logoutCallbackURLs: string[]
  isPublic: boolean
  pkceEnabled: boolean
  credentials?: { secrets?: PocketIdSecret[] }
  createdSecret?: PocketIdSecretCreated
  [key: string]: unknown
}

type PocketIdSecret = {
  id: string
  prefix: string
  isActive: boolean
}

type PocketIdSecretCreated = PocketIdSecret & { secret: string }
type ClientList = { data: PocketIdClient[] }

const adminUrl = process.env.DEV_OIDC_ADMIN_URL?.replace(/\/$/, '')
const apiKey = process.env.DEV_OIDC_API_KEY
const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const envPath = '.env.local'
const clientName = 'Nuxt full-stack starter'

if (!adminUrl || !apiKey) {
  console.error('Missing DEV_OIDC_ADMIN_URL or DEV_OIDC_API_KEY. Set both to provision Pocket ID; GitHub OAuth does not require them.')
  process.exit(2)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${adminUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
        ...init?.headers,
      },
    })
  }
  catch (error) {
    throw new Error(`Pocket ID is unavailable at ${adminUrl}`, { cause: error })
  }

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Pocket ID API ${init?.method || 'GET'} ${path} returned ${response.status}: ${detail}`)
  }

  return (response.status === 204 ? undefined : await response.json()) as T
}

async function readLocalEnv() {
  try {
    return await readFile(envPath, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

function getEnvValue(source: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`^${escaped}=(.*)$`, 'm'))?.[1]
}

function setEnvValues(source: string, values: Record<string, string>) {
  const lines = source.split(/\r?\n/)
  const remaining = new Map(Object.entries(values))
  const managedKeys = new Set(Object.keys(values))
  const output = lines.map((line) => {
    const separator = line.indexOf('=')
    const key = separator > 0 ? line.slice(0, separator) : ''
    const value = remaining.get(key)

    if (!managedKeys.has(key)) return line
    if (value === undefined) return undefined
    remaining.delete(key)
    return `${key}=${value}`
  }).filter(line => line !== undefined)

  if (remaining.size) {
    if (output.some(Boolean)) output.push('')
    output.push('# Managed by bun run auth:provision')
    for (const [key, value] of remaining) output.push(`${key}=${value}`)
  }

  return `${output.join('\n').replace(/^\n+|\n+$/g, '')}\n`
}

async function main() {
  const localEnv = await readLocalEnv()
  const existingClientId = getEnvValue(localEnv, 'NUXT_OIDC_CLIENT_ID')
  const existingSecret = getEnvValue(localEnv, 'NUXT_OIDC_CLIENT_SECRET')
  const redirectUrl = `${appBaseUrl}/api/auth/callback/oidc`
  const list = await request<ClientList>('/api/oidc/clients?pagination[limit]=100')
  let client = list.data.find(candidate => candidate.name === clientName || candidate.id === existingClientId)

  const desired = {
    name: clientName,
    description: 'Local Nuxt starter development client',
    callbackURLs: [redirectUrl],
    logoutCallbackURLs: [appBaseUrl],
    isPublic: false,
    pkceEnabled: true,
  }

  if (client) {
    client = await request<PocketIdClient>(`/api/oidc/clients/${encodeURIComponent(client.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...client, ...desired }),
    })
  }
  else {
    client = await request<PocketIdClient>('/api/oidc/clients', {
      method: 'POST',
      body: JSON.stringify(desired),
    })
  }

  let clientSecret = existingClientId === client.id ? existingSecret : undefined

  if (!clientSecret) {
    clientSecret = client.createdSecret?.secret
  }

  if (!clientSecret) {
    const created = await request<PocketIdSecretCreated>(`/api/oidc/clients/${encodeURIComponent(client.id)}/secrets`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    clientSecret = created.secret
  }

  if (!clientSecret) {
    throw new Error('Pocket ID created no usable client secret. No local credentials were changed.')
  }

  const nextEnv = setEnvValues(localEnv, {
    NUXT_OIDC_ISSUER: adminUrl,
    NUXT_OIDC_CLIENT_ID: client.id,
    NUXT_OIDC_CLIENT_SECRET: clientSecret,
  })

  await writeFile(envPath, nextEnv, { mode: 0o600 })
  await chmod(envPath, 0o600)
  console.log(`Provisioned Pocket ID client ${client.id}; credentials saved to ignored ${envPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Pocket ID provisioning failed')
  process.exit(1)
})
