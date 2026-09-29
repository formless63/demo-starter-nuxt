import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface ExternalRequirement {
  name: string
  required: boolean
}

interface Capability {
  id: string
  displayName: string
  status: 'done' | 'in-progress' | 'planned' | 'evaluate' | 'deferred'
  defaultInstalled: boolean
  requires: string[]
  externalRequirements: ExternalRequirement[]
  packageName?: string
  packagePath?: string
}

interface Catalog {
  capabilities: Capability[]
}

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const root = process.cwd()
const [catalog, manifest, nuxtConfig] = await Promise.all([
  Bun.file(resolve(root, 'capabilities/catalog.json')).json() as Promise<Catalog>,
  Bun.file(resolve(root, 'package.json')).json() as Promise<PackageManifest>,
  readFile(resolve(root, 'nuxt.config.ts'), 'utf8'),
])
const rootDependencies = {
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.optionalDependencies,
}

async function pathExists(path?: string) {
  if (!path) return false
  try {
    await access(resolve(root, path))
    return true
  }
  catch {
    return false
  }
}

function moduleIsRegistered(packageName?: string) {
  if (!packageName || !rootDependencies[packageName]) return false
  return [`'${packageName}'`, `"${packageName}"`, `\`${packageName}\``]
    .some(literal => nuxtConfig.includes(literal))
}

function yesNo(value: boolean) {
  return value ? 'yes' : 'no'
}

console.info('Capability status (catalog + root reference application)')
for (const capability of catalog.capabilities) {
  const sourcePresent = await pathExists(capability.packagePath)
  const external = capability.externalRequirements.length === 0
    ? 'none'
    : capability.externalRequirements
        .map(requirement => `${requirement.name} (${requirement.required ? 'required' : 'optional'})`)
        .join(', ')

  console.info(`\n${capability.id} — ${capability.displayName}`)
  console.info(`  status: ${capability.status}`)
  console.info(`  available: ${yesNo(capability.status === 'done' && sourcePresent)}`)
  console.info(`  default installed: ${yesNo(capability.defaultInstalled)}`)
  console.info(`  package source present: ${yesNo(sourcePresent)}`)
  console.info(`  enabled in reference app: ${yesNo(moduleIsRegistered(capability.packageName))}`)
  console.info(`  requires: ${capability.requires.join(', ') || 'none'}`)
  console.info(`  external: ${external}`)
}
