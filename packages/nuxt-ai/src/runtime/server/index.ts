import OpenAI from 'openai'
import { z } from 'zod'
import type { AiConfig } from './config'
import { resolveAiConfig } from './config'
import { AiError, safeAiError } from './errors'
import type { AiFinishReason, AiInput, AiOperationOptions, AiStreamEvent, AiStructuredResult, AiTextResult, AiUsage } from './types'
import { AI_LIMITS } from './types'

export { z } from 'zod'
export { AiError } from './errors'
export type { AiErrorCode } from './errors'
export { resolveAiConfig } from './config'
export type { AiConfig } from './config'
export { AI_LIMITS } from './types'
export type * from './types'

const inputSchema = z.strictObject({
  messages: z.array(z.strictObject({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })).min(1).max(AI_LIMITS.messages),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(65536).optional(),
})
export function validateAiInput(input: AiInput): AiInput {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new AiError('invalid-request')
  let bytes = 0
  for (const message of parsed.data.messages) {
    if (!message.content.trim() || !message.content.isWellFormed() || /\p{Cc}/u.test(message.content.replace(/[\t\n\r]/gu, ''))) throw new AiError('invalid-request')
    const size = Buffer.byteLength(message.content, 'utf8')
    if (size > AI_LIMITS.messageBytes) throw new AiError('invalid-request')
    bytes += size
  }
  if (bytes > AI_LIMITS.inputBytes) throw new AiError('invalid-request')
  return parsed.data
}
function finishReason(reason: string): AiFinishReason {
  return reason === 'stop' || reason === 'length' ? reason : reason === 'content_filter' ? 'content-filter' : 'other'
}
function usage(value: unknown): AiUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const result: AiUsage = {}
  for (const [source, target] of [['prompt_tokens', 'inputTokens'], ['completion_tokens', 'outputTokens'], ['total_tokens', 'totalTokens']] as const) {
    const count = raw[source]
    if (typeof count === 'number' && Number.isFinite(count) && Number.isInteger(count) && count >= 0) result[target] = count
  }
  return Object.keys(result).length ? result : undefined
}
function scope(seconds: number, caller?: AbortSignal) {
  const controller = new AbortController()
  const deadline = performance.now() + seconds * 1000
  let code: 'timeout' | 'cancelled' | 'invalid-output' | undefined
  const abort = (reason: 'timeout' | 'cancelled' | 'invalid-output') => {
    if (!controller.signal.aborted) { code = reason; controller.abort() }
  }
  const onAbort = () => abort('cancelled')
  if (caller?.aborted) onAbort()
  else caller?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => abort('timeout'), seconds * 1000)
  const check = () => {
    if (!code && performance.now() >= deadline) abort('timeout')
    if (code) throw new AiError(code)
  }
  return {
    signal: controller.signal, check,
    invalidOutput: () => abort('invalid-output'),
    cancel: () => abort('cancelled'),
    classify: (error: unknown) => code ? new AiError(code) : safeAiError(error),
    dispose: () => { clearTimeout(timer); caller?.removeEventListener('abort', onAbort); controller.abort() },
    async wait<T>(promise: Promise<T>): Promise<T> {
      check()
      let listener: () => void = () => {}
      const aborted = new Promise<never>((_, reject) => {
        listener = () => reject(new AiError(code ?? 'cancelled'))
        controller.signal.addEventListener('abort', listener, { once: true })
      })
      try { return await Promise.race([promise, aborted]) }
      finally { controller.signal.removeEventListener('abort', listener) }
    },
  }
}

// Configuration, SDK client creation and network use are all operation-lazy.
// Clients use standard fetch and own no pools/background resources requiring Nitro hooks.
export function createAi(env: Record<string, string | undefined> = process.env) {
  function start(input: AiInput, options: AiOperationOptions) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'signal')
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) throw new AiError('invalid-request')
    if (options.signal !== undefined) {
      try { Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(options.signal) }
      catch { throw new AiError('invalid-request') }
    }
    const validated = validateAiInput(input)
    const config = resolveAiConfig(env)
    const operation = scope(config.timeoutSeconds, options.signal)
    return { input: validated, config, operation }
  }
  async function* providerEvents(input: AiInput, config: AiConfig, operation: ReturnType<typeof scope>, structured: boolean): AsyncGenerator<AiStreamEvent> {
    let stream: Awaited<ReturnType<OpenAI['chat']['completions']['create']>> | undefined
    try {
      operation.check()
      const client = new OpenAI({
        // SDK requires a nonempty constructor key; explicit null header omits it on wire.
        apiKey: config.apiKey ?? 'unused-local-adapter-key', adminAPIKey: null, webhookSecret: null, baseURL: config.baseUrl,
        organization: null, project: null, maxRetries: 0, logLevel: 'off',
        timeout: config.timeoutSeconds * 1000,
        defaultHeaders: config.apiKey ? {} : { Authorization: null },
        // SDK custom-header environment settings are outside the finite AI config.
        // Rebuild wire headers explicitly and reject redirects for credential privacy.
        fetch: async (url, init) => {
          const response = await fetch(url, {
            ...init, redirect: 'error',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream',
              ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
          })
          if (!response.body) return response
          const reader = response.body.getReader()
          let bytes = 0
          // Bound every raw body before SDK JSON/SSE buffering, including error envelopes.
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const result = await reader.read()
                if (result.done) { controller.close(); reader.releaseLock(); return }
                bytes += result.value.byteLength
                if (bytes > 33554432) {
                  operation.invalidOutput()
                  await reader.cancel().catch(() => {})
                  throw new AiError('invalid-output')
                }
                controller.enqueue(result.value)
              }
              catch (error) { controller.error(operation.classify(error)) }
            },
            async cancel() { await reader.cancel().catch(() => {}) },
          })
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
        },
      })
      stream = await client.chat.completions.create({
        model: config.model, messages: input.messages,
        temperature: input.temperature, max_tokens: input.maxOutputTokens,
        ...(structured ? { response_format: { type: 'json_object' as const } } : {}),
        stream: true, stream_options: { include_usage: true },
      }, { signal: operation.signal })
      let bytes = 0
      let pendingHigh = ''
      let reason: AiFinishReason | undefined
      let counts: AiUsage | undefined
      for await (const chunk of stream) {
        operation.check()
        if (!chunk || !Array.isArray(chunk.choices) || chunk.choices.some(value => !value || typeof value !== 'object' || !Number.isInteger(value.index) || !value.delta || typeof value.delta !== 'object')) throw new AiError('invalid-output')
        const choice = chunk.choices.find(value => value.index === 0)
        if (choice?.delta && Object.keys(choice.delta).some(key => !['content', 'role'].includes(key))) throw new AiError('invalid-output')
        const text = choice?.delta?.content
        if (text !== undefined && text !== null) {
          if (typeof text !== 'string' || reason !== undefined) throw new AiError('invalid-output')
          if (text) {
            let delta = pendingHigh + text
            pendingHigh = ''
            const last = delta.charCodeAt(delta.length - 1)
            if (last >= 0xd800 && last <= 0xdbff) { pendingHigh = delta.slice(-1); delta = delta.slice(0, -1) }
            if (!delta.isWellFormed()) throw new AiError('invalid-output')
            bytes += Buffer.byteLength(delta, 'utf8')
            if (bytes > AI_LIMITS.outputBytes) throw new AiError('invalid-output')
            if (delta) yield { type: 'text-delta', text: delta }
          }
        }
        if (choice?.finish_reason != null) {
          if (reason !== undefined || typeof choice.finish_reason !== 'string') throw new AiError('invalid-output')
          reason = finishReason(choice.finish_reason)
        }
        counts = usage(chunk.usage) ?? counts
      }
      operation.check()
      if (reason === undefined || pendingHigh) throw new AiError('invalid-output')
      yield { type: 'finish', finishReason: reason, ...(counts ? { usage: counts } : {}) }
    }
    catch (error) { throw operation.classify(error) }
    finally {
      // Includes breaks, pending read cancellation, overflow and normal completion.
      if (stream && 'controller' in stream) stream.controller.abort()
    }
  }
  async function collect(input: AiInput, config: AiConfig, operation: ReturnType<typeof scope>, structured: boolean): Promise<AiTextResult> {
    let text = ''
    let terminal: Extract<AiStreamEvent, { type: 'finish' }> | undefined
    for await (const event of providerEvents(input, config, operation, structured)) {
      if (event.type === 'text-delta') text += event.text
      else terminal = event
    }
    if (!terminal) throw new AiError('invalid-output')
    return { text, finishReason: terminal.finishReason, ...(terminal.usage ? { usage: terminal.usage } : {}) }
  }
  return {
    provider: 'openai-compatible' as const,
    async generateText(value: AiInput, options: AiOperationOptions = {}): Promise<AiTextResult> {
      const { input, config, operation } = start(value, options)
      try { return await collect(input, config, operation, false) }
      catch (error) { throw operation.classify(error) }
      finally { operation.dispose() }
    },
    async generateStructured<T>(value: AiInput, schema: z.ZodType<T>, options: AiOperationOptions = {}): Promise<AiStructuredResult<T>> {
      const { input, config, operation } = start(value, options)
      try {
        const result = await collect(input, config, operation, true)
        if (result.finishReason !== 'stop') throw new AiError('invalid-output')
        let json: unknown
        try { json = JSON.parse(result.text) }
        catch { throw new AiError('invalid-output') }
        let parsed: z.ZodSafeParseResult<T>
        try { parsed = await operation.wait(schema.safeParseAsync(json)) }
        catch (error) { operation.check(); throw error instanceof AiError ? error : new AiError('invalid-output') }
        operation.check()
        if (!parsed.success) throw new AiError('invalid-output')
        return { data: parsed.data, finishReason: result.finishReason, ...(result.usage ? { usage: result.usage } : {}) }
      }
      catch (error) { throw operation.classify(error) }
      finally { operation.dispose() }
    },
    streamText(value: AiInput, options: AiOperationOptions = {}): AsyncIterableIterator<AiStreamEvent> {
      const { input, config, operation } = start(value, options)
      const iterator = providerEvents(input, config, operation, false)
      // return() aborts immediately, even if next() is currently awaiting provider IO.
      // Native async-generator return alone queues behind that read and cannot do this.
      let done = false
      return {
        [Symbol.asyncIterator]() { return this },
        async next() {
          if (done) return { done: true, value: undefined }
          try {
            const result = await iterator.next()
            if (result.done || result.value.type === 'finish') { done = true; operation.dispose(); await iterator.return(undefined) }
            return result
          }
          catch (error) { done = true; operation.dispose(); throw safeAiError(error) }
        },
        async return() {
          done = true; operation.cancel()
          try { await iterator.return(undefined) }
          catch { /* A pending next receives the safe cancellation error. */ }
          finally { operation.dispose() }
          return { done: true, value: undefined }
        },
        async throw() { await this.return!(); throw new AiError('cancelled') },
      }
    },
  }
}
export type Ai = ReturnType<typeof createAi>
let singleton: Ai | undefined
export function getAi(): Ai { return singleton ??= createAi() }
