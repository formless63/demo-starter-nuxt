// Repository-only proof of documented application removal; no remote resource changes.
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const root = process.cwd()
const temporaryRoot = await mkdtemp(join(tmpdir(), 'email-reference-removal-'))
async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: temporaryRoot, env: { ...process.env, NUXT_MAGIC_LINK_ENABLED: 'false', NUXT_PUBLIC_MAGIC_LINK_ENABLED: 'false' }, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited) throw new Error('Reference Email removal verification failed')
}
async function edit(path: string, change: (text: string) => string) {
  const target = join(temporaryRoot, path)
  await writeFile(target, change(await readFile(target, 'utf8')))
}
try {
  for (const entry of await readdir(root)) {
    if (['.git', 'node_modules', '.nuxt', '.output', '.data', 'test-results', 'playwright-report', '.env', '.env.local'].includes(entry)) continue
    await cp(join(root, entry), join(temporaryRoot, entry), { recursive: true, verbatimSymlinks: true,
      filter: path => !['node_modules', '.nuxt', '.output', 'dist', '.env', '.env.local'].includes(basename(path)) })
  }
  await edit('package.json', (text) => {
    const manifest = JSON.parse(text)
    delete manifest.dependencies['@repo/nuxt-email']
    manifest.scripts = Object.fromEntries(Object.entries(manifest.scripts).filter(([name]) => !name.startsWith('email:')))
    return `${JSON.stringify(manifest, null, 2)}\n`
  })
  await edit('nuxt.config.ts', text => text.replace(", '@repo/nuxt-email'", ''))
  await edit('capabilities/catalog.json', (text) => {
    const catalog = JSON.parse(text)
    catalog.referenceApplication.enabledCapabilities = catalog.referenceApplication.enabledCapabilities.filter((id: string) => id !== 'email')
    const email = catalog.capabilities.find((entry: { id: string }) => entry.id === 'email')
    email.scripts = email.scripts.filter((name: string) => !name.startsWith('email:'))
    return `${JSON.stringify(catalog, null, 2)}\n`
  })
  await edit('compose.yaml', text => text.split('\n').filter(line => !/^\s*(SMTP_|EMAIL_)/u.test(line)).join('\n'))
  await edit('.env.example', text => text.split('\n').filter(line => !/^(SMTP_|EMAIL_)/u.test(line)).join('\n'))
  await edit('server/utils/auth.ts', text => text.replace("genericOAuth, magicLink", 'genericOAuth')
    .split('\n').filter(line => !line.includes('@repo/nuxt-email') && !line.includes("'./observed-email'")).join('\n')
    .replace(/ {2}if \(config\.magicLinkEnabled\) \{[\s\S]*?\n {2}\}\n/u, '  // Magic links deliberately disabled after Email removal.\n'))
  await edit('tests/unit/api-platform.test.ts', text => text.split('\n').filter(line => !line.includes('mailpitEnv') && !line.includes('magicLinkEnabled: true')).join('\n')
    .replace("['api-key', 'generic-oauth', 'magic-link']", "['api-key', 'generic-oauth']"))
  for (const path of ['server/utils/observed-email.ts', 'scripts/email.ts', 'compose.email.yaml', 'tests/unit/email.test.ts',
    'tests/unit/email-observability.test.ts', 'tests/unit/email-auth.integration.test.ts']) await rm(join(temporaryRoot, path))
  await run(['bun', 'install'])
  await run(['bun', 'run', 'agents:check'])
  await run(['bun', 'run', 'capabilities:check'])
  await run(['bun', 'run', 'typecheck'])
  await run(['bun', 'run', 'build'])
  console.info('[email] Reference removal with magic links disabled: harness/catalog/typecheck/build passed')
}
finally { await rm(temporaryRoot, { recursive: true, force: true }) }
