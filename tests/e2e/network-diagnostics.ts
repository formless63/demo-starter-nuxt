import { spawnSync } from 'node:child_process'

/** Synthetic fixture network events only; omit labels, addresses and container identities. */
export function reportFixtureNetworkEvents(project: string, since: number) {
  const command = process.env.STORAGE_DOCKER_SUDO === 'true' ? 'sudo' : 'docker'
  const prefix = command === 'sudo' ? ['-n', 'docker'] : []
  const result = spawnSync(command, [...prefix, 'events', '--since', String(Math.floor(since / 1000)), '--until', String(Math.ceil(Date.now() / 1000)), '--filter', 'type=network', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{json .}}'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 262144 })
  if (result.status !== 0) { console.info('[network-diagnostics] unavailable'); return }
  const allowed = new Set(['create', 'connect', 'disconnect', 'destroy'])
  const events: Array<{ action: string, epochMs: number }> = []
  for (const line of result.stdout.split('\n').filter(Boolean).slice(-80)) {
    try {
      const item = JSON.parse(line) as { Type?: string, Action?: string, time?: number, timeNano?: number }
      if (item.Type === 'network' && allowed.has(item.Action ?? '')) events.push({ action: item.Action!, epochMs: item.timeNano ? Math.floor(item.timeNano / 1e6) : (item.time ?? 0) * 1000 })
    }
    catch { /* Never print raw external output. */ }
  }
  console.info(`[network-diagnostics] ${JSON.stringify({ since, events })}`)
}
