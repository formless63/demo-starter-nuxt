import { AsyncLocalStorage } from 'node:async_hooks'
import pino from 'pino'
import type { DestinationStream, Logger, LogFn } from 'pino'
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import type { Attributes, Context, Span, SpanOptions } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { metadata, safeError, safeText, sanitize } from './safety'

export interface ObservabilityOptions {
  serviceName?: string
  logLevel?: string
  redactKeys?: string[]
  destination?: DestinationStream
  /** Tests/embedded consumers may provide an isolated environment. */
  env?: Record<string, string | undefined>
}
export interface BuildInfo {
  service: string
  version: string
  revision: string
  environment: string
  runtime: string
}
export interface RequestContext {
  requestId: string
  span: Span
  otelContext: Context
  startedAt: number
  finished?: boolean
}
export interface ServerLogger {
  trace: LogFn
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
  fatal: LogFn
  child: (fields: Record<string, unknown>) => ServerLogger
}

function safeLogger(logger: Logger, keys: string[]): ServerLogger {
  return {
    trace: logger.trace.bind(logger), debug: logger.debug.bind(logger), info: logger.info.bind(logger),
    warn: logger.warn.bind(logger), error: logger.error.bind(logger), fatal: logger.fatal.bind(logger),
    // Pino resets the binding formatter on child(); sanitize BEFORE it sees bindings.
    child: fields => safeLogger(logger.child(sanitize(fields, keys) as Record<string, unknown>), keys),
  }
}

const logContext = new AsyncLocalStorage<Record<string, unknown>>()
let requestResolver: (() => RequestContext | undefined) | undefined
let state: ReturnType<typeof createState> | undefined
const propagator = new W3CTraceContextPropagator()

function endpoint(env: Record<string, string | undefined>, signal: 'TRACES' | 'METRICS') {
  if (env[`OTEL_${signal}_EXPORTER`] === 'none') return undefined
  const mode = env[`OTEL_${signal}_EXPORTER`]
  if (mode && mode !== 'otlp') throw new Error('Only otlp and none telemetry exporters are supported')
  const specific = env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]
  const configured = specific || env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!configured) return undefined // Never instantiate the exporter with its localhost default.
  try {
    const url = new URL(configured)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error()
    if (!specific) url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/${signal.toLowerCase()}`
    return url.toString()
  }
  catch { throw new Error('Invalid OTLP endpoint; use HTTP(S) and put credentials in OTLP headers') }
}

function createState(options: ObservabilityOptions) {
  const env = options.env ?? process.env
  const runtimeName = process.versions.bun ? 'bun' : 'nodejs'
  const runtimeVersion = process.versions.bun || process.versions.node
  const build: BuildInfo = {
    service: metadata(env.OTEL_SERVICE_NAME || options.serviceName, 'nuxt-application'),
    version: metadata(env.APP_VERSION, 'unknown'),
    revision: metadata(env.APP_REVISION, 'unknown'),
    environment: metadata(env.DEPLOYMENT_ENVIRONMENT || env.NODE_ENV, 'development'),
    runtime: `${runtimeName}-${runtimeVersion}`,
  }
  const redactKeys = options.redactKeys ?? []
  const level = env.LOG_LEVEL || options.logLevel || 'info'
  if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(level)) throw new Error('Invalid log level')
  const logger = pino({
    level,
    base: build,
    serializers: { err: safeError },
    // formatters cover ordinary structured fields and child bindings; hooks cover string/Error overloads.
    formatters: { log: fields => sanitize(fields, redactKeys) as Record<string, unknown>, bindings: bindings => sanitize(bindings, redactKeys) as Record<string, unknown> },
    mixin: () => correlation(),
    hooks: { logMethod(args, method) {
      const safeArgs = args.map(arg => sanitize(arg, redactKeys))
      method.apply(this, safeArgs as Parameters<typeof method>)
    } },
  }, options.destination)
  const disabled = env.OTEL_SDK_DISABLED === 'true'
  const traceEndpoint = disabled ? undefined : endpoint(env, 'TRACES')
  const metricEndpoint = disabled ? undefined : endpoint(env, 'METRICS')
  const attributes = Object.fromEntries((env.OTEL_RESOURCE_ATTRIBUTES ?? '').split(',').flatMap((part) => {
    const index = part.indexOf('=')
    if (index < 1) return []
    return [[part.slice(0, index).trim(), safeText(part.slice(index + 1).trim())]]
  }))
  const resource = resourceFromAttributes({
    ...sanitize(attributes, redactKeys) as Attributes,
    'service.name': build.service, 'service.version': build.version,
    'vcs.ref.head.revision': build.revision, 'deployment.environment.name': build.environment,
    'process.runtime.name': runtimeName, 'process.runtime.version': runtimeVersion,
  })
  const contextManager = new AsyncLocalStorageContextManager().enable()
  const traces = new NodeTracerProvider({
    resource,
    spanProcessors: traceEndpoint ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: traceEndpoint, timeoutMillis: 1000 }), { exportTimeoutMillis: 1500 })] : [],
  })
  // Disabled SDK uses the API's no-op tracer; request IDs and logs still work.
  if (!disabled) traces.register({ contextManager, propagator })
  const meters = new MeterProvider({
    resource,
    readers: metricEndpoint ? [new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: metricEndpoint, timeoutMillis: 1000 }),
      exportIntervalMillis: 60_000, exportTimeoutMillis: 1500,
    })] : [],
  })
  const tracer = disabled ? trace.getTracer('nuxt-observability-disabled') : traces.getTracer('nuxt-observability', '0.1.0')
  return { build, logger, publicLogger: safeLogger(logger, redactKeys), traces, meters, tracer, contextManager, redactKeys, disabled,
    exporting: { traces: Boolean(traceEndpoint), metrics: Boolean(metricEndpoint) }, shutdown: undefined as Promise<void> | undefined }
}

export function initializeObservability(options: ObservabilityOptions = {}) {
  state ??= createState(options)
  return { build: state.build, enabled: !state.disabled, exporting: state.exporting }
}
function runtime() { initializeObservability(); return state! }
export function getBuildInfo(): Readonly<BuildInfo> { return { ...runtime().build } }
export function getObservabilityStatus() { const s = runtime(); return { enabled: !s.disabled, exporting: { ...s.exporting } } }
export function getLogger(): ServerLogger { return runtime().publicLogger }
export function getTracer() { return runtime().tracer }
export function getMeter() { return runtime().meters.getMeter('nuxt-observability', '0.1.0') }

/** Adapter supplied by the Nitro plugin; standalone processes don't import Nitro. */
export function setRequestContextResolver(resolver: () => RequestContext | undefined) { requestResolver = resolver }
export function getRequestContext() { return requestResolver?.() }
export function getRequestId() { return getRequestContext()?.requestId }
export function withLogContext<T>(fields: Record<string, unknown>, fn: () => T): T {
  return logContext.run({ ...logContext.getStore(), ...sanitize(fields, runtime().redactKeys) as Record<string, unknown> }, fn)
}
function currentContext() {
  const active = context.active()
  return trace.getSpan(active) ? active : getRequestContext()?.otelContext ?? active
}
function correlation() {
  const spanContext = trace.getSpan(currentContext())?.spanContext()
  return { ...logContext.getStore(), requestId: getRequestId(),
    ...(spanContext && spanContext.traceId !== '00000000000000000000000000000000'
      ? { traceId: spanContext.traceId, spanId: spanContext.spanId } : {}) }
}
export function captureException(error: unknown, requestSpan?: Span) {
  const safe = safeError(error)
  const span = requestSpan ?? trace.getSpan(currentContext())
  span?.recordException({ name: safe.type, message: safe.message })
  span?.setStatus({ code: SpanStatusCode.ERROR })
  getLogger().error({ err: safe }, 'operation.failed')
}
export async function withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, options: SpanOptions = {}): Promise<T> {
  const attributes = sanitize(options.attributes ?? {}, runtime().redactKeys) as Attributes
  const span = getTracer().startSpan(safeText(name), { ...options, attributes }, currentContext())
  return context.with(trace.setSpan(currentContext(), span), async () => {
    try { return await fn(span) }
    catch (error) { captureException(error); throw error }
    finally { span.end() }
  })
}

export function beginRequest(requestId: string, method: string, traceparent?: string): RequestContext {
  // Only W3C traceparent is extracted: no raw headers or baggage in telemetry.
  const parent = propagator.extract(ROOT_CONTEXT, { traceparent }, { keys: carrier => Object.keys(carrier), get: (carrier, key) => carrier[key as 'traceparent'] })
  const span = getTracer().startSpan(method, { kind: SpanKind.SERVER, attributes: { 'http.request.method': method } }, parent)
  return { requestId, span, otelContext: trace.setSpan(parent, span), startedAt: performance.now() }
}
export function finishRequest(request: RequestContext, method: string, route: string, status: number) {
  if (request.finished) return
  request.finished = true
  const attrs = { 'http.request.method': method, 'http.route': route, 'http.response.status_code': status }
  const seconds = (performance.now() - request.startedAt) / 1000
  request.span.updateName(`${method} ${route}`)
  request.span.setAttributes(attrs)
  if (status >= 500) request.span.setStatus({ code: SpanStatusCode.ERROR })
  const meter = getMeter()
  meter.createCounter('app.http.requests').add(1, attrs)
  meter.createHistogram('http.server.request.duration', { unit: 's' }).record(seconds, attrs)
  if (status >= 500) meter.createCounter('app.http.errors').add(1, attrs)
  context.with(request.otelContext, () => withLogContext({ requestId: request.requestId }, () =>
    getLogger().info({ ...attrs, durationMs: seconds * 1000 }, 'request.completed')))
  request.span.end()
}

/** Bounded names must come from a registered job/operation, never user input. IDs are log-only. */
export async function observeOperation<T>(kind: 'job' | 'api', name: string, fn: () => T | Promise<T>, fields: Record<string, unknown> = {}, status?: () => number): Promise<T> {
  const attr = kind === 'job' ? 'job.name' : 'api.operation_id'
  const started = performance.now()
  return withLogContext({ ...fields, [attr]: name }, () => withSpan(`${kind} ${name}`, async (span) => {
    let failed = false
    try { return await fn() }
    catch (error) { failed = true; throw error }
    finally {
      const code = status?.()
      if (code && code >= 400) failed = true
      if (failed) span.setStatus({ code: SpanStatusCode.ERROR })
      const attrs = { [attr]: name, outcome: failed ? 'failure' : 'success', ...(code ? { 'http.response.status_code': code } : {}) }
      span.setAttributes(attrs)
      const seconds = (performance.now() - started) / 1000
      getMeter().createCounter(`app.${kind}.executions`).add(1, attrs)
      getMeter().createHistogram(`app.${kind}.duration`, { unit: 's' }).record(seconds, attrs)
      if (failed) getMeter().createCounter(`app.${kind}.failures`).add(1, attrs)
      getLogger().info({ ...attrs, durationMs: seconds * 1000 }, `${kind}.completed`)
    }
  }, { kind: kind === 'job' ? SpanKind.CONSUMER : SpanKind.INTERNAL, attributes: { [attr]: name } }))
}

async function bounded(work: Promise<unknown>, timeout = 2500) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, timeout) })]) }
  finally { clearTimeout(timer) }
}
export async function flushObservability() {
  if (!state) return
  await bounded(Promise.allSettled([state.traces.forceFlush(), state.meters.forceFlush()]))
}
export async function shutdownObservability() {
  if (!state) return
  const s = state
  s.shutdown ??= (async () => {
    await flushObservability()
    await bounded(Promise.allSettled([s.traces.shutdown(), s.meters.shutdown()]))
    s.contextManager.disable()
    s.logger.flush()
  })()
  await s.shutdown
}
