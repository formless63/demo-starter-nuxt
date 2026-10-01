import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { createAi, getAi, resolveAiConfig, validateAiInput, AiError, z } from '@repo/nuxt-ai/server'
import { startProvider } from './provider.ts'

// SDK environment defaults must never leak into adapter config or turn on logging.
process.env.OPENAI_API_KEY = 'PRIVATE_ENV_KEY'
process.env.OPENAI_ADMIN_KEY = 'PRIVATE_ADMIN_KEY'
process.env.OPENAI_WEBHOOK_SECRET = 'PRIVATE_WEBHOOK_SECRET'
process.env.OPENAI_ORG_ID = 'PRIVATE_ORGANIZATION'
process.env.OPENAI_PROJECT_ID = 'PRIVATE_PROJECT'
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1'
process.env.OPENAI_LOG = 'debug'
process.env.OPENAI_CUSTOM_HEADERS = 'x-private-header: PRIVATE_HEADER'
const fixture = await startProvider()
const ai = createAi({ NODE_ENV: 'test', AI_MODEL: 'fixture-model', AI_BASE_URL: fixture.baseUrl, AI_TIMEOUT_SECONDS: '1' })
const input = (mode: string) => ({ messages: [{ role: 'user' as const, content: mode }] })
async function fails(action: () => unknown, code: string) {
  try { await action(); assert.fail(`Expected ${code}`) }
  catch (error) {
    assert(error instanceof AiError)
    assert.equal(error.code, code)
    assert.equal(error.retryable, ['rate-limit', 'unavailable'].includes(code))
    assert.deepEqual(Object.keys(error.toJSON()).sort(), ['code', 'message', 'retryable'])
    assert(!('cause' in error))
    for (const rendered of [JSON.stringify(error), inspect(error), String(error)]) {
      assert(!rendered.includes('PRIVATE_PROVIDER_CONTENT'))
      assert(!rendered.includes('api-key-secret'))
    }
  }
}
async function waitForDisconnect(mode: string) {
  const deadline = Date.now() + 2000
  while (!fixture.disconnected[mode] && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert(fixture.disconnected[mode], `Provider connection cancelled for ${mode}`)
}
try {
  console.info(`[ai] Adapter runtime ${process.version}; ${typeof Bun === 'undefined' ? 'Node' : 'Bun'}`)
  if (typeof Bun === 'undefined') assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Adapter executes on Node 24')
  assert(getAi(), 'Singleton itself is backendless')
  assert.equal(resolveAiConfig({ AI_MODEL: '模型😀' }).model, '模型😀')
  assert.equal(resolveAiConfig({ AI_MODEL: 'x' }).provider, 'openai-compatible')
  assert.equal(resolveAiConfig({ AI_MODEL: 'x' }).timeoutSeconds, 60)
  assert.equal(resolveAiConfig({ AI_MODEL: 'x' }).baseUrl, 'https://api.openai.com/v1')
  for (const env of [{}, { AI_MODEL: '' }, { AI_MODEL: 'x\n' }, { AI_MODEL: 'x'.repeat(129) }, { AI_MODEL: 'x', AI_PROVIDER: 'other' }, ...['0','301','1.5','NaN',''].map(AI_TIMEOUT_SECONDS => ({ AI_MODEL: 'x', AI_TIMEOUT_SECONDS })), ...['http://127.1/v1','http://2130706433/v1','http://example.com/v1','ftp://localhost','https://user:secret@example.com','https://example.com?secret=x'].map(AI_BASE_URL => ({ AI_MODEL: 'x', AI_BASE_URL }))]) {
    assert.throws(() => resolveAiConfig(env), { code: 'configuration' })
  }
  for (const model of ['a', '😀'.repeat(128), '模型 😀 /punctuation!', '\ue000']) assert.equal(resolveAiConfig({ AI_MODEL: model }).model, model)
  for (const model of ['', '😀'.repeat(129), '  ', '\ud800', '\udc00', 'x\u0085', 'x\u200d', 'x\u2028', 'x\u2029']) assert.throws(() => resolveAiConfig({ AI_MODEL: model }), { code: 'configuration' })
  for (const key of ['x\r', 'x\n', 'x\0', 'x\t', 'x\u007f', 'x\u0080', 'x\ud800', 'x😀', 'x ']) assert.throws(() => resolveAiConfig({ AI_MODEL: 'x', AI_API_KEY: key }), { code: 'configuration' })
  assert.equal(resolveAiConfig({ AI_MODEL: 'x', AI_API_KEY: ' é:key' }).apiKey, ' é:key')
  for (const NODE_ENV of ['development', 'test']) for (const host of ['localhost', '127.0.0.1', '[::1]']) assert(resolveAiConfig({ NODE_ENV, AI_MODEL: 'x', AI_BASE_URL: `http://${host}/v1` }))
  for (const NODE_ENV of [undefined, 'production']) assert.throws(() => resolveAiConfig({ NODE_ENV, AI_MODEL: 'x', AI_BASE_URL: fixture.baseUrl }), { code: 'configuration' })
  for (const options of [null, [], { signal: {} }, { signal: Object.create(AbortSignal.prototype) }, { signal: { aborted: true } }, { extra: true }]) await fails(() => ai.generateText(input('invalid-options'), options as never), 'invalid-request')
  assert.equal(fixture.requests['invalid-options'], undefined)
  for (const content of ['', ' \t\n', '\0', '\u0085', '\ud800', '\udc00']) await fails(() => ai.generateText(input(content)), 'invalid-request')
  assert.equal(validateAiInput(input(' a\t\n\r')).messages[0]!.content, ' a\t\n\r')
  assert.equal(validateAiInput(input('x'.repeat(65536))).messages[0]!.content.length, 65536)
  await fails(() => ai.generateText(input('x'.repeat(65537))), 'invalid-request')
  assert.equal(validateAiInput({ messages: Array(100).fill({ role: 'user', content: 'x' }) }).messages.length, 100)
  assert.equal(validateAiInput({ messages: Array(4).fill({ role: 'user', content: 'é'.repeat(32768) }) }).messages.length, 4)
  await fails(() => ai.generateText({ messages: [...Array(4).fill({ role: 'user', content: 'x'.repeat(65536) }), { role: 'user', content: 'x' }] }), 'invalid-request')
  await fails(() => createAi({}).generateText(input('completion')), 'configuration')
  assert.equal(validateAiInput({ messages: [{ role: 'system', content: 'é'.repeat(32768) }], temperature: 2, maxOutputTokens: 65536 }).messages.length, 1)
  for (const value of [ { messages: [] }, { messages: Array(101).fill({ role: 'user', content: '' }) }, { messages: [{ role: 'tool', content: '' }] }, { messages: [{ role: 'user', content: ['image'] }] }, input('é'.repeat(32769)), { messages: Array(5).fill({ role: 'user', content: 'x'.repeat(65536) }) }, { ...input('x'), temperature: NaN }, { ...input('x'), temperature: 2.1 }, { ...input('x'), maxOutputTokens: 1.5 }, { ...input('x'), tools: [] } ]) {
    await fails(() => ai.generateText(value as Parameters<typeof ai.generateText>[0]), 'invalid-request')
  }
  assert.deepEqual(await ai.generateText(input('completion')), { text: 'hello world', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } })
  await createAi({ NODE_ENV: 'test', AI_MODEL: 'fixture-model', AI_BASE_URL: fixture.baseUrl, AI_API_KEY: 'fixture-test-key' }).generateText(input('key'))
  assert(fixture.authenticated.key, 'Configured key is used only server-side')
  for (const [mode, reason] of [['length','length'],['filter','content-filter'],['other','other']]) assert.equal((await ai.generateText(input(mode!))).finishReason, reason)
  assert.equal((await ai.generateText(input('bad-usage'))).usage, undefined)
  assert.deepEqual((await ai.generateStructured(input('json'), z.object({ value: z.string() }))).data, { value: 'ok' })
  for (const mode of ['schema','malformed','json-length','json-filter','json-other']) await fails(() => ai.generateStructured(input(mode), z.object({ value: z.string() })), 'invalid-output')
  const events = []
  for await (const event of ai.streamText(input('stream'))) {
    if (events.length === 0) assert(!fixture.completed.stream, 'First delta precedes final provider output')
    events.push(event)
  }
  assert.deepEqual(events, [{ type: 'text-delta', text: 'hello ' }, { type: 'text-delta', text: 'world' }, { type: 'finish', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }])
  for (const [mode, code] of [['auth','authentication'],['forbidden','authentication'],['request-timeout','timeout'],['redirect','unavailable'],['rate','rate-limit'],['unavailable','unavailable'],['invalid','invalid-request'],['malformed-sse','invalid-output'],['bad-protocol','invalid-output'],['incomplete','invalid-output'],['stream-error','invalid-output'],['oversized','invalid-output']]) {
    await fails(() => ai.generateText(input(mode!)), code!)
    assert.equal(fixture.requests[mode!], 1, 'No automatic retry')
  }
  for (const [mode, code] of [['auth', 'authentication'], ['forbidden', 'authentication'], ['rate', 'rate-limit'], ['invalid', 'invalid-request'], ['unavailable', 'unavailable'], ['malformed-sse', 'invalid-output'], ['incomplete', 'invalid-output'], ['stream-error', 'invalid-output'], ['oversized', 'invalid-output']]) {
    const before = fixture.requests[mode!] ?? 0
    let finishes = 0
    await fails(async () => { for await (const event of ai.streamText(input(mode!))) if (event.type === 'finish') finishes++ }, code!)
    assert.equal(finishes, 0)
    assert.equal(fixture.requests[mode!]! - before, 1)
  }
  await fails(() => createAi({ NODE_ENV: 'test', AI_MODEL: 'x', AI_BASE_URL: 'http://127.0.0.1:1/v1' }).generateText(input('connection')), 'unavailable')
  assert.equal((await ai.generateStructured(input('structured-limit'), z.object({ value: z.string() }))).data.value.length, 1048576 - 12)
  await fails(() => ai.generateStructured(input('structured-over'), z.any()), 'invalid-output')
  assert.equal(Buffer.byteLength((await ai.generateText(input('limit'))).text), 1048576, 'Exact UTF-8 cap succeeds')
  await fails(() => ai.generateStructured(input('oversized'), z.any()), 'invalid-output')
  await fails(async () => { for await (const _event of ai.streamText(input('oversized'))) { /* Consume. */ } }, 'invalid-output')
  const generous = createAi({ NODE_ENV: 'test', AI_MODEL: 'fixture-model', AI_BASE_URL: fixture.baseUrl, AI_TIMEOUT_SECONDS: '20' })
  for (const mode of ['split-limit', 'split-empty']) assert.equal(Buffer.byteLength((await generous.generateText(input(mode))).text), 1048576)
  for (const mode of ['lone-high', 'lone-low', 'bad-pair', 'many-overflow', 'raw-sse', 'raw-envelope', 'raw-error']) {
    let finishes = 0
    await fails(async () => { for await (const event of generous.streamText(input(mode))) if (event.type === 'finish') finishes++ }, 'invalid-output')
    assert.equal(finishes, 0)
    if (mode.startsWith('raw-') || mode === 'many-overflow') await waitForDisconnect(mode)
  }
  const mutable = input('completion')
  const snapshotted = ai.generateText(mutable)
  mutable.messages[0]!.content = 'PRIVATE_MUTATION'
  assert.equal((await snapshotted).text, 'hello world')
  assert.equal(fixture.requests.PRIVATE_MUTATION, undefined)
  await createAi({ NODE_ENV: 'test', AI_MODEL: 'fixture-model', AI_BASE_URL: fixture.baseUrl, AI_API_KEY: '' }).generateText(input('empty-key'))
  assert.equal(fixture.authenticated['empty-key'], false)
  for (const mode of ['stall','stall-headers']) {
    await fails(() => ai.generateText(input(mode)), 'timeout')
    await waitForDisconnect(mode)
  }
  const timed = ai.streamText(input('timeout-stream'))
  await timed.next()
  await new Promise(resolve => setTimeout(resolve, 1100))
  await waitForDisconnect('timeout-stream')
  await fails(() => timed.next(), 'timeout')
  const pre = new AbortController(); pre.abort('PRIVATE_PROVIDER_CONTENT')
  await fails(() => ai.generateText(input('pre-cancel'), { signal: pre.signal }), 'cancelled')
  assert.equal(fixture.requests['pre-cancel'], undefined)
  const abort = new AbortController()
  const stream = ai.streamText(input('cancel'), { signal: abort.signal })
  assert.equal((await stream.next()).value?.type, 'text-delta')
  const pending = stream.next(); abort.abort('PRIVATE_PROVIDER_CONTENT')
  await fails(() => pending, 'cancelled'); await waitForDisconnect('cancel')
  const returned = ai.streamText(input('return'))
  await returned.next()
  const blocked = returned.next()
  const failure = fails(() => blocked, 'cancelled')
  await returned.return!(); await failure; await waitForDisconnect('return')
  for await (const _event of ai.streamText(input('pause'))) { break }
  await waitForDisconnect('pause')
  // Whole-operation deadline also covers asynchronous Zod validation.
  await fails(() => ai.generateStructured(input('json'), z.object({ value: z.string() }).refine(async () => { await new Promise(resolve => setTimeout(resolve, 1200)); return true })), 'timeout')
  await fails(() => ai.generateStructured(input('json'), z.any().refine(() => new Promise<boolean>(() => {}))), 'timeout')
  const validationAbort = new AbortController()
  const refinementStarted = Promise.withResolvers<undefined>()
  const validating = ai.generateStructured(input('json'), z.any().refine(async () => { refinementStarted.resolve(undefined); await new Promise(resolve => setTimeout(resolve, 200)); throw new Error('PRIVATE_REFINEMENT') }), { signal: validationAbort.signal })
  await refinementStarted.promise
  validationAbort.abort('PRIVATE_REASON')
  await fails(() => validating, 'cancelled')
  await new Promise(resolve => setTimeout(resolve, 250))
  await fails(() => ai.generateStructured(input('json'), z.any().refine(() => { const end = performance.now() + 1100; while (performance.now() < end) { /* Delayed timer delivery. */ } return true })), 'timeout')
  console.info('[ai] Actual OpenAI adapter contract passed')
}
finally { await fixture.close() }
