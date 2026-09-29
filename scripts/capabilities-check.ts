import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'

interface BaselineEntry {
  id: string
}

interface Capability {
  id: string
  status: 'done' | 'in-progress' | 'planned' | 'evaluate' | 'deferred'
  defaultInstalled: boolean
  requires: string[]
  integratesWith: string[]
  baselineRequirements?: string[]
  baselineIntegrations?: string[]
  externalRequirements: Array<{ name: string }>
  scripts?: string[]
  documentationPath?: string
  agentSkill?: string
  evaluationDocument?: string
  modulePath?: string
}

interface Catalog {
  baseline: BaselineEntry[]
  capabilities: Capability[]
}

interface PackageManifest {
  scripts?: Record<string, string>
}

const root = process.cwd()
const catalogPath = resolve(root, 'capabilities/catalog.json')
const schemaPath = resolve(root, 'capabilities/catalog.schema.json')
const packagePath = resolve(root, 'package.json')

const [catalogData, schema, packageManifest] = await Promise.all([
  Bun.file(catalogPath).json() as Promise<unknown>,
  Bun.file(schemaPath).json() as Promise<object>,
  Bun.file(packagePath).json() as Promise<PackageManifest>,
])

const ajv = new Ajv2020({ allErrors: true, strict: true })
const validate = ajv.compile(schema)

if (!validate(catalogData)) {
  console.error('Capability catalog does not conform to capabilities/catalog.schema.json:')
  for (const error of validate.errors ?? []) {
    console.error(`- ${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
  }
  process.exit(1)
}

const catalog = catalogData as Catalog
const errors: string[] = []
const capabilityIds = new Set<string>()
const baselineIds = new Set<string>()

for (const entry of catalog.baseline) {
  if (baselineIds.has(entry.id)) errors.push(`Duplicate baseline ID: ${entry.id}`)
  baselineIds.add(entry.id)
}

for (const capability of catalog.capabilities) {
  if (capabilityIds.has(capability.id)) errors.push(`Duplicate capability ID: ${capability.id}`)
  capabilityIds.add(capability.id)
  if (baselineIds.has(capability.id)) {
    errors.push(`Capability ID ${capability.id} collides with a starter baseline ID`)
  }
}

function duplicates(values: string[]) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
}

async function assertPath(label: string, path: string) {
  try {
    await access(resolve(root, path))
  }
  catch {
    errors.push(`${label} does not exist: ${path}`)
  }
}

for (const capability of catalog.capabilities) {
  for (const [relationship, references] of [
    ['requires', capability.requires],
    ['integratesWith', capability.integratesWith],
  ] as const) {
    for (const reference of references) {
      if (reference === capability.id) errors.push(`${capability.id} cannot ${relationship} itself`)
      if (baselineIds.has(reference)) {
        errors.push(`${capability.id}.${relationship} contains baseline ${reference}; use a baseline relationship`)
      }
      else if (!capabilityIds.has(reference)) {
        errors.push(`${capability.id}.${relationship} references unknown capability ${reference}`)
      }
    }
    for (const duplicate of duplicates(references)) {
      errors.push(`${capability.id}.${relationship} contains duplicate ${duplicate}`)
    }
  }

  for (const reference of capability.requires.filter(id => capability.integratesWith.includes(id))) {
    errors.push(`${capability.id} cannot both require and optionally integrate with ${reference}`)
  }

  const baselineRequirements = capability.baselineRequirements ?? []
  const baselineIntegrations = capability.baselineIntegrations ?? []
  for (const [relationship, references] of [
    ['baselineRequirements', baselineRequirements],
    ['baselineIntegrations', baselineIntegrations],
  ] as const) {
    for (const reference of references) {
      if (!baselineIds.has(reference)) {
        errors.push(`${capability.id}.${relationship} references unknown baseline ${reference}`)
      }
    }
    for (const duplicate of duplicates(references)) {
      errors.push(`${capability.id}.${relationship} contains duplicate ${duplicate}`)
    }
  }
  for (const reference of baselineRequirements.filter(id => baselineIntegrations.includes(id))) {
    errors.push(`${capability.id} cannot both require and optionally integrate with baseline ${reference}`)
  }

  for (const script of capability.scripts ?? []) {
    if (!packageManifest.scripts?.[script]) errors.push(`${capability.id} declares missing package script ${script}`)
  }

  const externalNames = capability.externalRequirements.map(requirement => requirement.name)
  for (const duplicate of duplicates(externalNames)) {
    errors.push(`${capability.id}.externalRequirements contains duplicate ${duplicate}`)
  }

  if (capability.status === 'done') {
    const expectedPath = `capabilities/${capability.id}/CAPABILITY.md`
    if (capability.documentationPath !== expectedPath) {
      errors.push(`${capability.id} documentationPath must be ${expectedPath}`)
    }
    await assertPath(`${capability.id} capability documentation`, expectedPath)
  }
  if (capability.evaluationDocument) {
    await assertPath(`${capability.id} evaluation document`, capability.evaluationDocument)
  }
  if (capability.agentSkill) await assertPath(`${capability.id} agent skill`, capability.agentSkill)
  if (capability.modulePath) {
    await assertPath(`${capability.id} module`, capability.modulePath)
    await assertPath(`${capability.id} Nuxt module entry`, `${capability.modulePath}/index.ts`)
  }
}

const visiting = new Set<string>()
const visited = new Set<string>()
const stack: string[] = []
const capabilitiesById = new Map(catalog.capabilities.map(capability => [capability.id, capability]))

function visit(id: string) {
  if (visited.has(id)) return
  if (visiting.has(id)) {
    const start = stack.indexOf(id)
    errors.push(`Hard dependency cycle: ${[...stack.slice(start), id].join(' -> ')}`)
    return
  }

  visiting.add(id)
  stack.push(id)
  for (const requirement of capabilitiesById.get(id)?.requires ?? []) visit(requirement)
  stack.pop()
  visiting.delete(id)
  visited.add(id)
}

for (const id of capabilityIds) visit(id)

if (errors.length > 0) {
  console.error('Capability catalog checks failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const completed = catalog.capabilities.filter(capability => capability.status === 'done').length
console.info(`Capability catalog is valid (${catalog.capabilities.length} capabilities, ${completed} done)`)
