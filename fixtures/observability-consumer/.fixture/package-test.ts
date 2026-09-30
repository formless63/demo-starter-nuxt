import assert from 'node:assert/strict'

type Json = Record<string, unknown>
const received: Array<{ path: string, body: Json }> = []
const receiver = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request) {
    assert.equal(request.headers.get('content-type'), 'application/json')
    assert.equal(request.headers.get('x-fixture'), 'collector-proof')
    received.push({ path: new URL(request.url).pathname, body: await request.json() as Json })
    return Response.json({})
  },
})
const otlp = `http://127.0.0.1:${receiver.port}`
const reserve = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
const port = reserve.port
reserve.stop(true)
const baseUrl = `http://127.0.0.1:${port}`
const env = {
  ...Bun.env, NODE_ENV: 'production', NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1',
  APP_VERSION: '1.2.3', APP_REVISION: 'fixture-revision', DEPLOYMENT_ENVIRONMENT: 'test',
  OTEL_EXPORTER_OTLP_HEADERS: 'x-fixture=collector-proof',
  OTEL_SERVICE_NAME: '', OTEL_SDK_DISABLED: 'false',
  OTEL_TRACES_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'otlp',
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '', OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: '',
  OTEL_RESOURCE_ATTRIBUTES: 'fixture.name=consumer,token=RESOURCE_SECRET',
}

async function ready(server: ReturnType<typeof Bun.spawn>) {
  for (let attempt = 0; attempt < 80; attempt++) {
    assert.equal(server.exitCode, null, 'Production server exited before readiness')
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return }
    catch { /* Server is starting. */ }
    await Bun.sleep(100)
  }
  throw new Error('Production server did not become ready')
}

async function stop(server: ReturnType<typeof Bun.spawn>) {
  if (server.exitCode === null) server.kill('SIGTERM')
  const timeout = setTimeout(() => server.kill('SIGKILL'), 10_000)
  try { assert.equal(await server.exited, 0, 'Graceful shutdown failed or exceeded its deadline') }
  finally { clearTimeout(timeout) }
}

function logs(text: string) {
  assert(!text.includes('_SECRET'), 'Secret entered structured logs')
  return text.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as Json)
}
function flatten(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(flatten)
  if (!value || typeof value !== 'object') return []
  return [value as Json, ...Object.values(value).flatMap(flatten)]
}

try {
  // Useful logs and context without any collector; absence of endpoint must never imply localhost.
  for (const endpoint of ['', otlp]) {
    const before = received.length
    const server = Bun.spawn(['node', '.output/server/index.mjs'], {
      env: { ...env, OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }, stdout: 'pipe', stderr: 'pipe',
    })
    const output = new Response(server.stdout).text()
    const errors = new Response(server.stderr).text()
    try {
      await ready(server)
      const incomingTrace = '11111111111111111111111111111111'
      const [slow, fast] = await Promise.all([
        fetch(`${baseUrl}/api/probe/slow?token=QUERY_SECRET`, { headers: {
          'X-Request-ID': 'slow-request', traceparent: `00-${incomingTrace}-2222222222222222-01`,
          authorization: 'Bearer REQUEST_AUTH_SECRET', cookie: 'COOKIE_HEADER_SECRET', 'x-api-key': 'REQUEST_KEY_SECRET',
        } }),
        fetch(`${baseUrl}/api/probe/fast`, { headers: { 'X-Request-ID': 'fast-request' } }),
      ])
      assert.equal(slow.headers.get('x-request-id'), 'slow-request')
      assert.equal((await slow.json()).requestId, 'slow-request')
      assert.equal((await fast.json()).requestId, 'fast-request')
      const invalid = await fetch(`${baseUrl}/api/probe/invalid`, { headers: { 'X-Request-ID': 'bad id!' } })
      assert.match(invalid.headers.get('x-request-id')!, /^[a-f0-9-]{36}$/)
      assert.equal((await invalid.json()).requestId, invalid.headers.get('x-request-id'))
      const tooLong = await fetch(`${baseUrl}/api/probe/long`, { headers: { 'X-Request-ID': 'a'.repeat(65) } })
      assert.notEqual(tooLong.headers.get('x-request-id'), 'a'.repeat(65))
      const generated = await fetch(`${baseUrl}/api/probe/generated`)
      assert.match(generated.headers.get('x-request-id')!, /^[a-f0-9-]{36}$/)
      const failure = await fetch(`${baseUrl}/api/failure`)
      assert.equal(failure.status, 500)
      assert.equal((await failure.json()).error.code, 'internal_error')
      const uncaught = await fetch(`${baseUrl}/api/uncaught?token=UNCAUGHT_QUERY_SECRET`)
      assert.equal(uncaught.status, 500)
      const uncaughtBody = await uncaught.json()
      assert.equal(uncaughtBody.message, 'Server Error')
      assert(!JSON.stringify(uncaughtBody).includes('_SECRET'))
      const health = await (await fetch(`${baseUrl}/api/health`)).json()
      assert.equal(health.build.version, '1.2.3')
      assert.equal(health.build.revision, 'fixture-revision')
      assert(!JSON.stringify(health).includes('postgres'))
    }
    finally { await stop(server) }
    const lines = logs(await output)
    assert.equal(await errors, '', 'Telemetry produced unexpected stderr noise')
    const slowLog = lines.find(line => line.msg === 'fixture.nested' && line.requestId === 'slow-request')
    const fastLog = lines.find(line => line.msg === 'fixture.nested' && line.requestId === 'fast-request')
    assert(slowLog && fastLog, 'Request context did not survive concurrent awaits')
    assert.equal(slowLog.service, 'observability-fixture')
    assert.equal(slowLog.component, 'fixture')
    assert.equal(slowLog.traceId, '11111111111111111111111111111111')
    assert.match(String(slowLog.spanId), /^[0-9a-f]{16}$/)
    assert.notEqual(fastLog.traceId, slowLog.traceId)
    assert(lines.some(line => line.msg === 'fixture.child' && line.requestId === 'slow-request'))
    assert(lines.some(line => line.msg === 'operation.failed' && (line.err as Json).message === 'An operation failed'))
    if (!endpoint) assert.equal(received.length, before, 'No-backend mode tried exporting')
  }

  for (const mode of ['both', 'traces', 'metrics', 'disabled', 'unavailable']) {
    const before = received.length
    const child = Bun.spawn(['node', '.fixture/standalone.mjs'], {
      env: { ...env,
        OTEL_EXPORTER_OTLP_ENDPOINT: mode === 'unavailable' ? 'http://127.0.0.1:1' : otlp,
        OTEL_TRACES_EXPORTER: mode === 'metrics' ? 'none' : 'otlp',
        OTEL_METRICS_EXPORTER: mode === 'traces' ? 'none' : 'otlp',
        OTEL_SDK_DISABLED: mode === 'disabled' ? 'true' : 'false',
      }, stdout: 'pipe', stderr: 'pipe',
    })
    const output = new Response(child.stdout).text()
    const errors = new Response(child.stderr).text()
    const timeout = setTimeout(() => child.kill('SIGKILL'), 8000)
    try { assert.equal(await child.exited, 0, `Standalone ${mode} did not flush and exit: ${await errors}`) }
    finally { clearTimeout(timeout) }
    const lines = logs(await output)
    assert.equal(await errors, '')
    assert(lines.some(line => line.msg === 'job.completed' && line.outcome === 'success' && line.jobId === 'worker-job-id'))
    assert(lines.some(line => line.msg === 'job.completed' && line.outcome === 'failure'))
    assert(lines.every(line => line.service === 'fixture-worker'), 'Initialization was not idempotent')
    const paths = received.slice(before).map(item => item.path)
    if (mode === 'disabled' || mode === 'unavailable') assert.equal(paths.length, 0)
    else {
      assert.equal(paths.includes('/v1/traces'), mode !== 'metrics')
      assert.equal(paths.includes('/v1/metrics'), mode !== 'traces')
    }
  }

  const serialized = JSON.stringify(received)
  assert(!serialized.includes('_SECRET'), 'Secret entered OTLP')
  const traces = flatten(received.filter(item => item.path === '/v1/traces'))
  const spans = traces.filter(item => typeof item.traceId === 'string' && typeof item.name === 'string')
  assert(spans.some(span => span.name === 'fixture.operation'))
  assert(spans.some(span => span.name === 'GET /api/probe/:id'))
  assert(spans.some(span => span.name === 'fixture.failure' && (span.status as Json).code === 2))
  assert(spans.some(span => span.name === 'job fixture.fail' && (span.status as Json).code === 2))
  const metrics = flatten(received.filter(item => item.path === '/v1/metrics'))
  for (const name of ['app.http.requests', 'http.server.request.duration', 'app.http.errors', 'app.job.executions', 'app.job.duration', 'app.job.failures']) {
    assert(metrics.some(metric => metric.name === name), `Missing exported metric ${name}`)
  }
  const dimensions = metrics.filter(item => Array.isArray(item.attributes)).flatMap(item => item.attributes as Json[])
  assert(dimensions.some(attr => attr.key === 'http.route' && (attr.value as Json).stringValue === '/api/probe/:id'))
  for (const attr of dimensions) {
    assert(!['requestId', 'traceId', 'spanId', 'jobId', 'userId', 'url.full', 'url.path'].includes(String(attr.key)))
    assert(!JSON.stringify(attr).includes('slow-request'))
  }
  console.info('[observability fixture] safe logs, concurrent context, spans, metrics, OTLP, independent signals, no-backend and bounded shutdown passed')
}
finally { receiver.stop(true) }
