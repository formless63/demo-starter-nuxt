import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
assert.equal(Number(spawnSync('node', ['-p', 'process.versions.node.split(".")[0]'], { encoding: 'utf8' }).stdout.trim()), 24)
for (const runtime of ['node', 'bun']) {
  const result = spawnSync(runtime, ['.fixture/protocol.ts'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } })
  assert.equal(result.status, 0, `${runtime} protocol fixture failed`)
}

const database = spawnSync('bun', ['.fixture/database.ts'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } })
assert.equal(database.status, 0, 'Database fixture failed')
