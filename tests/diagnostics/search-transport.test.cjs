const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const vm = require('node:vm')

const preload = resolve(__dirname, '../e2e/fixtures/search-transport-diagnostics.cjs')
const source = readFileSync(preload, 'utf8')
const id = 'search-e2e-00000000-0000-4000-8000-000000000001'
const secondId = 'search-e2e-00000000-0000-4000-8000-000000000002'
const enabled = { CI: 'true', NUXT_E2E_SEARCH_TRANSPORT_DIAGNOSTICS: 'true' }

function harness(env = enabled, failWriter = false) {
  const lines = []
  const calls = []
  class ClientRequest extends EventEmitter {
    constructor(options) { super(); Object.assign(this, options) }
    getHeader(name) { return this.headers?.[name] }
  }
  class Server extends EventEmitter {}
  class Socket extends EventEmitter {}
  const http = { ClientRequest, Server, request: function (...args) {
    calls.push({ receiver: this, args })
    return new ClientRequest(args[0])
  } }
  const net = { Socket }
  const originals = [http.request, ClientRequest.prototype.emit, Server.prototype.emit, Socket.prototype.emit]
  const modules = { 'node:http': http, 'node:net': net, 'node:fs': { writeSync: (fd, line) => {
    assert.equal(fd, 2)
    if (failWriter) throw new Error('writer failed')
    lines.push(JSON.parse(line))
  } } }
  vm.runInNewContext(source, { process: { env }, require: name => modules[name] })
  const options = (changes = {}) => ({ method: 'GET', path: '/api/search/projects?q=PRIVATE_QUERY', headers: { 'x-request-id': id }, ...changes })
  return { http, net, lines, calls, originals, options }
}

test('disabled and non-CI loading leaves every original unchanged', () => {
  for (const env of [{}, { CI: 'true' }, { NUXT_E2E_SEARCH_TRANSPORT_DIAGNOSTICS: 'true' }, { ...enabled, CI: 'false' }]) {
    const h = harness(env)
    assert.deepEqual([h.http.request, h.http.ClientRequest.prototype.emit, h.http.Server.prototype.emit, h.net.Socket.prototype.emit], h.originals)
    assert.equal(h.lines.length, 0)
  }
})

test('unrelated, authenticated and invalid-marker requests never log', () => {
  const h = harness()
  for (const changes of [{ path: '/api/other?q=PRIVATE_QUERY' }, { method: 'POST' }, { headers: {} }, { headers: { 'x-request-id': 'REAL_USER_DATA' } }, ...['cookie', 'authorization', 'x-api-key'].map(name => ({ headers: { 'x-request-id': id, [name]: 'SECRET' } }))]) {
    const req = h.http.request(h.options(changes))
    req.emit('finish')
    new h.http.Server().emit('request', { ...h.options(changes), url: h.options(changes).path }, {})
  }
  assert.deepEqual(h.lines, [])
})

test('records bounded safe transport stages while preserving receivers, arguments and returns', () => {
  const h = harness()
  const options = h.options()
  const receiver = {}
  const callback = () => {}
  const req = Reflect.apply(h.http.request, receiver, [options, callback])
  assert.equal(h.calls[0].receiver, receiver)
  assert.equal(h.calls[0].args[0], options)
  assert.equal(h.calls[0].args[1], callback)
  assert.ok(req instanceof h.http.ClientRequest)
  const socket = new h.net.Socket()
  Object.assign(socket, { connecting: true, destroyed: false, readable: true, writable: true })
  let seen
  req.on('socket', function (value) { seen = { receiver: this, value } })
  assert.equal(req.emit('socket', socket), true)
  assert.equal(seen.receiver, req)
  assert.equal(seen.value, socket)
  assert.equal(socket.emit('connect'), false)
  assert.equal(req.emit('finish'), false)
  assert.equal(req.emit('response', { statusCode: 401, headers: { secret: 'SECRET' }, body: 'PRIVATE_BODY' }), false)
  const server = new h.http.Server()
  const incoming = { ...options, url: options.path }
  const response = {}
  server.on('request', function (...args) { seen = { receiver: this, args } })
  assert.equal(server.emit('request', incoming, response), true)
  assert.equal(seen.receiver, server)
  assert.deepEqual(seen.args, [incoming, response])
  req.on('error', () => {})
  req.emit('error', { code: 'PRIVATE_ERROR', message: 'SECRET', stack: 'SECRET' })
  assert.deepEqual(h.lines.map(line => line.stage), ['client-dispatch', 'client-socket', 'client-socket-connect', 'client-finish', 'client-response', 'public-entry', 'client-error'])
  assert.equal(h.lines.at(-1).code, 'OTHER')
  assert.equal(h.lines.find(line => line.stage === 'client-response').status, 401)
  const allowed = new Set(['stage', 'time', 'id', 'status', 'code', 'connecting', 'destroyed', 'readable', 'writable'])
  for (const line of h.lines) {
    assert.equal(line.id, id)
    assert.ok(Number.isFinite(Date.parse(line.time)))
    for (const key of Object.keys(line)) assert.ok(allowed.has(key))
  }
  assert.doesNotMatch(JSON.stringify(h.lines), /SECRET|PRIVATE|query|headers|cookie|body|stack|socketPath/)
  h.http.request(h.options({ headers: { 'x-request-id': secondId } })).emit('finish')
  assert.equal(h.lines.length, 7)
  for (let i = 0; i < 100; i++) req.emit('finish')
  assert.equal(h.lines.length, 64)
})

test('socket reuse and request close retire the selected diagnostic context', () => {
  for (const changes of [{ path: '/api/other' }, { headers: { 'x-request-id': id, cookie: 'SECRET' } }, { headers: { 'x-request-id': secondId } }]) {
    const h = harness()
    const socket = new h.net.Socket()
    socket.on('error', () => {})
    const selected = h.http.request(h.options())
    selected.emit('socket', socket)
    selected.emit('response', { statusCode: 401 })
    const count = h.lines.length
    h.http.request(h.options(changes)).emit('socket', socket)
    socket.emit('error', { code: 'ECONNRESET' })
    socket.emit('close')
    assert.equal(h.lines.length, count)
  }
  const h = harness()
  const socket = new h.net.Socket()
  const selected = h.http.request(h.options())
  selected.emit('socket', socket)
  selected.emit('close')
  const count = h.lines.length
  socket.emit('connect')
  socket.emit('close')
  assert.equal(h.lines.length, count)
})

test('observing errors does not suppress original EventEmitter throws', () => {
  const h = harness()
  const req = h.http.request(h.options())
  const error = new Error('original error')
  error.code = 'ECONNRESET'
  assert.throws(() => req.emit('error', error), value => value === error)
  assert.equal(h.lines.at(-1).code, 'ECONNRESET')
  const socket = new h.net.Socket()
  req.emit('socket', socket)
  assert.throws(() => socket.emit('error', error), value => value === error)
})

test('writer failures do not change original calls or error propagation', () => {
  const h = harness(enabled, true)
  const req = h.http.request(h.options())
  assert.equal(req.emit('finish'), false)
  const error = new Error('original')
  assert.throws(() => req.emit('error', error), value => value === error)
})

test('proxy and Nitro worker entry are distinguished without exposing addresses', () => {
  const h = harness({ ...enabled, NITRO_DEV_WORKER_ID: '7' })
  h.http.request(h.options({ socketPath: 'PRIVATE_SOCKET' }))
  new h.http.Server().emit('request', { ...h.options(), url: h.options().path }, {})
  assert.deepEqual(h.lines.map(line => line.stage), ['proxy-dispatch', 'nitro-entry'])
  assert.doesNotMatch(JSON.stringify(h.lines), /PRIVATE_SOCKET/)
})

test('NODE_OPTIONS preload reaches the Node runner, child CLI and Nitro-style worker', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { Worker } = require('node:worker_threads');
    const { spawnSync } = require('node:child_process');
    assert.match(require('node:http').request.toString(), /outgoingStage/);
    const child = spawnSync(process.execPath, ['-e', "require('node:assert/strict').match(require('node:http').request.toString(), /outgoingStage/)"], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const worker = new Worker("require('node:worker_threads').parentPort.postMessage(require('node:http').request.toString().includes('outgoingStage'))", { eval: true, env: { ...process.env, NITRO_DEV_WORKER_ID: '1' } });
    worker.on('message', value => assert.equal(value, true));
    worker.on('error', error => { throw error });
  `
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, ...enabled, NODE_OPTIONS: `--require=${preload}` }, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})
