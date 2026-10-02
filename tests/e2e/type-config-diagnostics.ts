import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'

/** Bounded config metadata only: no source text, environment values or payloads. */
export async function reportTypeConfig(stage: string, root = process.cwd()) {
  const files = await Promise.all(['tsconfig.json', '.nuxt/tsconfig.json', '.nuxt/tsconfig.app.json'].map(async file => {
    try {
      const path = join(root, file), content = await readFile(path)
      return { file, realpath: await realpath(path), bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }
    }
    catch (error) { return { file, error: (error as NodeJS.ErrnoException).code ?? 'read_failed' } }
  }))
  const errors: number[] = []
  const parsed = ts.getParsedCommandLineOfConfigFile(join(root, 'tsconfig.json'), {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => { errors.push(diagnostic.code) },
  })
  const options = parsed?.options
  console.info(`[type-config-diagnostics] ${JSON.stringify({
    stage, root, files,
    options: options ? { module: options.module, target: options.target, moduleResolution: options.moduleResolution, allowImportingTsExtensions: options.allowImportingTsExtensions, strict: options.strict } : null,
    fileCount: parsed?.fileNames.length ?? 0,
    diagnosticCodes: [...new Set([...errors, ...(parsed?.errors.map(error => error.code) ?? [])])].slice(0, 20),
  })}`)
}
