// Temporary, explicit synthetic CI probe. Never enable against live accounts.
// Observe Node HTTP events without adding listeners, retries, timers or requests.
if (process.env.CI === 'true' && process.env.NUXT_E2E_SEARCH_TRANSPORT_DIAGNOSTICS === 'true') {
  const http = require('node:http')
  const net = require('node:net')
  const { writeSync } = require('node:fs')
  const idPattern = /^search-e2e-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const errors = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECANCELED', 'ABORT_ERR'])
  const sockets = new WeakMap()
  const requestSockets = new WeakMap()
  let selectedId
  let entries = 0

  function observe(callback) {
    // Diagnostic failures must not replace the original operation or its errors.
    try { callback() }
    catch { /* No application errors are caught here. */ }
  }
  function identify(request, incoming = false) {
    const header = name => incoming ? request.headers?.[name] : request.getHeader(name)
    if (request.method !== 'GET' || (incoming ? request.url : request.path)?.split('?')[0] !== '/api/search/projects') return
    if (header('cookie') !== undefined || header('authorization') !== undefined || header('x-api-key') !== undefined) return
    const id = header('x-request-id')
    if (typeof id !== 'string' || !idPattern.test(id) || (selectedId && selectedId !== id)) return
    selectedId = id
    return id
  }
  function record(stage, id, extra = {}) {
    if (entries >= 64) return
    entries++
    writeSync(2, `${JSON.stringify({ stage, time: new Date().toISOString(), id, ...extra })}\n`)
  }
  function socketState(socket) {
    return { connecting: !!socket.connecting, destroyed: !!socket.destroyed, readable: !!socket.readable, writable: !!socket.writable }
  }
  function errorCode(error) {
    return errors.has(error?.code) ? error.code : 'OTHER'
  }
  function outgoingStage(request) {
    return request.socketPath ? 'proxy' : 'client'
  }

  const originalRequest = http.request
  http.request = function (...args) {
    const request = Reflect.apply(originalRequest, this, args)
    observe(() => {
      const id = identify(request)
      if (id) record(`${outgoingStage(request)}-dispatch`, id)
    })
    return request
  }
  const originalClientEmit = http.ClientRequest.prototype.emit
  http.ClientRequest.prototype.emit = function (event, ...args) {
    observe(() => {
      // A pooled socket can be reassigned to an unrelated or authenticated request.
      if (event === 'socket') sockets.delete(args[0])
      if (event === 'close') {
        const socket = requestSockets.get(this)
        if (socket && sockets.get(socket)?.request === this) sockets.delete(socket)
        requestSockets.delete(this)
      }
      const id = identify(this)
      if (!id) return
      const stage = outgoingStage(this)
      if (event === 'socket') {
        sockets.set(args[0], { id, stage, request: this })
        requestSockets.set(this, args[0])
        record(`${stage}-socket`, id, socketState(args[0]))
      }
      else if (event === 'finish' || event === 'close' || event === 'abort') record(`${stage}-${event}`, id)
      else if (event === 'response') {
        const status = args[0]?.statusCode
        if (Number.isInteger(status) && status >= 100 && status <= 599) record(`${stage}-response`, id, { status })
      }
      else if (event === 'error') record(`${stage}-error`, id, { code: errorCode(args[0]) })
    })
    return Reflect.apply(originalClientEmit, this, [event, ...args])
  }
  const originalSocketEmit = net.Socket.prototype.emit
  net.Socket.prototype.emit = function (event, ...args) {
    observe(() => {
      const context = sockets.get(this)
      if (!context) return
      if (event === 'connect' || event === 'close') record(`${context.stage}-socket-${event}`, context.id, socketState(this))
      else if (event === 'error') record(`${context.stage}-socket-error`, context.id, { code: errorCode(args[0]) })
      if (event === 'close') sockets.delete(this)
    })
    return Reflect.apply(originalSocketEmit, this, [event, ...args])
  }
  const originalServerEmit = http.Server.prototype.emit
  http.Server.prototype.emit = function (event, ...args) {
    observe(() => {
      if (event !== 'request') return
      const id = identify(args[0], true)
      if (id) record(process.env.NITRO_DEV_WORKER_ID ? 'nitro-entry' : 'public-entry', id)
    })
    return Reflect.apply(originalServerEmit, this, [event, ...args])
  }
}
