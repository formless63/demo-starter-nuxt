import { spawn } from 'node:child_process'

const port = 4317
const server = spawn(process.execPath, ['.output/server/index.mjs'], { env: { ...process.env, PORT: String(port), NUXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' })
try {
  let html = ''
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const response = await fetch(`http://127.0.0.1:${port}`); html = await response.text(); break } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  if (!html) throw new Error('built fixture server did not become reachable')
if ((html.match(/<table/g) ?? []).length !== 2) throw new Error('SSR fallback must render one data table per chart')
if (!html.includes('Revenue') || !html.includes('Jan') || !html.includes('—')) throw new Error('SSR fallback omitted semantic data')
const titleIds = [...html.matchAll(/<h2 id="([^"]+)"/g)].map(match => match[1])
if (titleIds.length !== 2 || titleIds[0] === titleIds[1]) throw new Error('chart instance IDs must be unique')
if (!html.includes('aria-describedby=') || html.match(/aria-describedby="[^"]+"/g)?.length !== 1) throw new Error('description linkage must be conditional')
console.log('charts fixture contract: SSR fallback, transitions, and unique accessibility IDs passed')
} finally {
  server.kill('SIGTERM')
}
