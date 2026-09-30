// Repository-only proof of the documented root removal, never an application installer.
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const root = process.cwd()
const temporaryRoot = await mkdtemp(join(tmpdir(), 'storage-reference-removal-'))
async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: temporaryRoot, env: process.env, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited) throw new Error(`Reference removal verification failed: ${command.join(' ')}`)
}
try {
  for (const entry of await readdir(root)) {
    if (['.git', 'node_modules', '.nuxt', '.output', '.data', 'test-results', 'playwright-report', '.env', '.env.local'].includes(entry)) continue
    await cp(join(root, entry), join(temporaryRoot, entry), {
      recursive: true,
      filter: path => !['node_modules', '.nuxt', '.output', 'dist', '.env', '.env.local'].includes(basename(path)),
    })
  }
  const manifestPath = join(temporaryRoot, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  delete manifest.dependencies['@repo/nuxt-storage']
  manifest.scripts = Object.fromEntries(Object.entries(manifest.scripts).filter(([name]) => !name.startsWith('storage:')))
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const configPath = join(temporaryRoot, 'nuxt.config.ts')
  await writeFile(configPath, (await readFile(configPath, 'utf8')).replace(", '@repo/nuxt-storage'", ''))
  const catalogPath = join(temporaryRoot, 'capabilities/catalog.json')
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  catalog.referenceApplication.enabledCapabilities = catalog.referenceApplication.enabledCapabilities.filter((id: string) => id !== 'object-storage')
  const storage = catalog.capabilities.find((entry: { id: string }) => entry.id === 'object-storage')
  storage.scripts = storage.scripts.filter((name: string) => !name.startsWith('storage:'))
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
  for (const file of ['.env.example', 'compose.yaml']) {
    const path = join(temporaryRoot, file)
    await writeFile(path, (await readFile(path, 'utf8')).split('\n').filter(line => !line.includes('STORAGE_')).join('\n'))
  }
  for (const path of ['server/utils/observed-storage.ts', 'server/plugins/storage.ts', 'scripts/storage.ts', 'scripts/storage-dev.ts',
    'tests/unit/storage.test.ts', 'tests/unit/storage-observability.test.ts', 'compose.storage.yaml']) {
    await rm(join(temporaryRoot, path))
  }
  await run(['bun', 'install'])
  await run(['bun', 'run', 'capabilities:check'])
  await run(['bun', 'run', 'typecheck'])
  await run(['bun', 'run', 'build'])
  console.info('[storage] Reference application removal typecheck/build/catalog passed; no external resources touched')
}
finally { await rm(temporaryRoot, { recursive: true, force: true }) }
