import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

interface PackageTestConfig {
  ownedDependencies: string[]
  runtimeScript?: string
  postRemovalScript?: string
  cleanupScript?: string
  removal: {
    scripts: string[]
    paths: string[]
    replacementNuxtConfig: string
  }
}

interface Capability {
  id: string
  status: string
  requires?: string[]
  packageName?: string
  packagePath?: string
  fixturePath?: string
  packageTest?: PackageTestConfig
}

interface Catalog {
  capabilities: Capability[]
}

interface PackageManifest {
  name?: string
  main?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  overrides?: Record<string, string>
}

const root = process.cwd()
const catalog = await Bun.file(resolve(root, 'capabilities/catalog.json')).json() as Catalog
const packagedCapabilities = catalog.capabilities.filter(capability =>
  ['done', 'in-progress'].includes(capability.status)
  && capability.packageName
  && capability.packagePath
  && capability.fixturePath,
)

function fail(message: string): never {
  throw new Error(`[packages] ${message}`)
}

function selectCapabilities(ids: string[], requireTest = false) {
  const available = requireTest
    ? packagedCapabilities.filter(capability => capability.packageTest)
    : packagedCapabilities
  if (ids.length === 0) return available.filter(capability => capability.status === 'done')

  return ids.map((id) => {
    const capability = available.find(candidate => candidate.id === id)
    return capability ?? fail(`Unknown package capability (done or in-progress): ${id}`)
  })
}

async function run(command: string[], cwd: string) {
  console.info(`[packages] ${command.join(' ')}`)
  const child = Bun.spawn(command, {
    cwd,
    env: Bun.env,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) fail(`${command.join(' ')} exited with ${exitCode}`)
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

function childPath(parent: string, path: string) {
  if (isAbsolute(path)) fail(`Fixture path must be relative: ${path}`)
  const target = resolve(parent, path)
  const distance = relative(parent, target)
  if (distance === '..' || distance.startsWith(`..${sep}`)) fail(`Fixture path escapes its root: ${path}`)
  return target
}

function installedPackagePath(consumerRoot: string, packageName: string) {
  return join(consumerRoot, 'node_modules', ...packageName.split('/'))
}

async function prepareRootPackages() {
  const manifest = await Bun.file(resolve(root, 'package.json')).json() as PackageManifest
  const rootDependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  }
  const selected = packagedCapabilities.filter(capability => rootDependencies[capability.packageName!])

  const closure = [...new Map(selected.flatMap(capability => packageClosure(capability)).map(entry => [entry.id, entry])).values()]
  for (const capability of closure) {
    await run(['bun', 'run', '--cwd', capability.packagePath!, 'dev:prepare'], root)
  }
}

function packageClosure(capability: Capability, visiting = new Set<string>()): Capability[] {
  if (visiting.has(capability.id)) fail(`Hard dependency cycle at ${capability.id}`)
  visiting.add(capability.id)
  const dependencies = (capability.requires ?? []).flatMap((id) => {
    const dependency = packagedCapabilities.find(candidate => candidate.id === id)
    if (!dependency) fail(`Missing hard package dependency ${id} for ${capability.id}`)
    return packageClosure(dependency, new Set(visiting))
  })
  return [...new Map([...dependencies, capability].map(entry => [entry.id, entry])).values()]
}

async function buildPackage(capability: Capability) {
  await run(['bun', 'run', '--cwd', capability.packagePath!, 'prepack'], root)
}

async function testPackage(capability: Capability) {
  const packageName = capability.packageName!
  const fixtureRoot = resolve(root, capability.fixturePath!)
  const config = capability.packageTest!
  const closure = packageClosure(capability)
  const retainedOwnedDependencies = new Set(closure.filter(entry => entry.id !== capability.id)
    .flatMap(entry => entry.packageTest?.ownedDependencies ?? []))
  const temporaryRoot = await mkdtemp(join(tmpdir(), `${capability.id}-package-install-`))
  const packRoot = join(temporaryRoot, 'package')
  const consumerRoot = join(temporaryRoot, 'consumer')
  let runtimeStarted = false

  try {
    await mkdir(packRoot)
    const archives = new Map<string, string>()
    for (const dependency of closure) {
      const destination = join(packRoot, dependency.id)
      await mkdir(destination)
      const packageRoot = resolve(root, dependency.packagePath!)
      await buildPackage(dependency)
      const stagedRoot = join(temporaryRoot, 'staged', dependency.id)
      await cp(packageRoot, stagedRoot, {
        recursive: true,
        filter: source => !['node_modules', '.nuxt', '.output'].includes(basename(source)),
      })
      const stagedManifestPath = join(stagedRoot, 'package.json')
      const stagedManifest = JSON.parse(await readFile(stagedManifestPath, 'utf8')) as PackageManifest
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
        for (const [name, version] of Object.entries(stagedManifest[field] ?? {})) {
          if (!version.startsWith('workspace:')) continue
          const archive = archives.get(name)
          if (!archive) fail(`Workspace dependency ${name} lacks a catalog hard dependency for ${dependency.id}`)
          stagedManifest[field]![name] = `file:${archive}`
        }
      }
      await writeFile(stagedManifestPath, `${JSON.stringify(stagedManifest, null, 2)}\n`)
      await run(['bun', 'pm', 'pack', '--ignore-scripts', '--destination', destination], stagedRoot)
      const archiveName = (await readdir(destination)).find(file => file.endsWith('.tgz'))
      if (!archiveName) fail(`${dependency.id} package build did not produce a tarball`)
      archives.set(dependency.packageName!, join(destination, archiveName))
    }

    await cp(fixtureRoot, consumerRoot, {
      recursive: true,
      filter: source => !['node_modules', '.nuxt', '.output'].includes(basename(source)),
    })

    const manifestPath = join(consumerRoot, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest
    manifest.dependencies ??= {}
    manifest.overrides ??= {}
    for (const [name, archive] of archives) {
      manifest.dependencies[name] = `file:${archive}`
      // Bun resolves private peer ranges via the registry unless the artifact also
      // overrides that name. Keep the entire hard-dependency graph external/local.
      manifest.overrides[name] = `file:${archive}`
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await run(['bun', 'install'], consumerRoot)
    for (const dependency of closure) {
      const name = dependency.packageName!
      const installed = JSON.parse(await readFile(join(installedPackagePath(consumerRoot, name), 'package.json'), 'utf8')) as PackageManifest
      if (!installed.main || !await exists(childPath(installedPackagePath(consumerRoot, name), installed.main))) {
        fail(`Packed hard dependency ${name} entrypoint was not installed`)
      }
    }
    const installedRoot = installedPackagePath(consumerRoot, packageName)
    const installedManifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8')) as PackageManifest
    if (!installedManifest.main || !await exists(childPath(installedRoot, installedManifest.main))) {
      fail(`Packed ${packageName} entrypoint was not installed`)
    }
    for (const dependency of config.ownedDependencies) {
      if (!await exists(join(installedPackagePath(consumerRoot, dependency), 'package.json'))) {
        fail(`${dependency} did not arrive with ${packageName}`)
      }
    }

    await run(['bun', 'run', 'typecheck'], consumerRoot)
    await run(['bun', 'run', 'build'], consumerRoot)
    if (config.runtimeScript) {
      runtimeStarted = true
      await run(['bun', 'run', config.runtimeScript], consumerRoot)
    }

    delete manifest.overrides?.[packageName]
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await run(['bun', 'remove', packageName], consumerRoot)
    const removedManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest
    delete removedManifest.overrides?.[packageName]
    const removedScripts = new Set(config.removal.scripts)
    removedManifest.scripts = Object.fromEntries(
      Object.entries(removedManifest.scripts ?? {}).filter(([script]) => !removedScripts.has(script)),
    )
    await writeFile(manifestPath, `${JSON.stringify(removedManifest, null, 2)}\n`)

    const replacementConfig = childPath(consumerRoot, config.removal.replacementNuxtConfig)
    await cp(replacementConfig, join(consumerRoot, 'nuxt.config.ts'))
    for (const path of config.removal.paths) {
      await rm(childPath(consumerRoot, path), { recursive: true, force: true })
    }
    for (const path of ['.nuxt', '.output', 'node_modules']) {
      await rm(join(consumerRoot, path), { recursive: true, force: true })
    }
    await run(['bun', 'install', '--frozen-lockfile'], consumerRoot)

    if (await exists(installedPackagePath(consumerRoot, packageName))) {
      fail(`${packageName} remained after removal`)
    }
    for (const dependency of config.ownedDependencies) {
      if (!retainedOwnedDependencies.has(dependency) && await exists(installedPackagePath(consumerRoot, dependency))) {
        fail(`Capability-owned dependency ${dependency} remained after removal`)
      }
    }
    await run(['bun', 'run', 'typecheck'], consumerRoot)
    await run(['bun', 'run', 'build'], consumerRoot)
    for (const dependency of packageClosure(capability).filter(entry => entry.id !== capability.id)) {
      if (!await exists(installedPackagePath(consumerRoot, dependency.packageName!))) fail(`Required package ${dependency.packageName} disappeared during removal`)
    }
    if (config.postRemovalScript) await run(['bun', 'run', config.postRemovalScript], consumerRoot)

    console.info(`[packages] ${capability.id} clean install, runtime, and removal verification passed`)
  }
  finally {
    try {
      if (runtimeStarted && config.cleanupScript) await run(['bun', 'run', config.cleanupScript], consumerRoot)
    }
    finally { await rm(temporaryRoot, { recursive: true, force: true }) }
  }
}

const [command, ...ids] = Bun.argv.slice(2)

switch (command) {
  case 'prepare':
    await prepareRootPackages()
    break
  case 'build':
    for (const capability of [...new Map(selectCapabilities(ids).flatMap(entry => packageClosure(entry)).map(entry => [entry.id, entry])).values()]) await buildPackage(capability)
    break
  case 'test':
    for (const capability of selectCapabilities(ids, true)) await testPackage(capability)
    break
  case 'matrix':
    // Authored in-progress fixtures participate in the same generic verification matrix.
    console.log(JSON.stringify({ capability: packagedCapabilities.filter(capability => capability.packageTest).map(capability => capability.id) }))
    break
  default:
    fail(`Usage: bun scripts/packages.ts <prepare|build|test|matrix> [capability ...]`)
}
