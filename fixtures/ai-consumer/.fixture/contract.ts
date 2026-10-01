import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { createAi, getAi, resolveAiConfig, validateAiInput, AiError, z } from '@repo/nuxt-ai/server'
import { startProvider } from './provider.ts'

// SDK environment defaults must never leak into adapter config or turn on logging.
process.env.OPENAI_API_KEY = 'PRIVATE_ENV_KEY'
process.env.OPENAI_ADMIN_KEY = 'PRIVATE_ADMIN_KEY'
process.env.OPENAI_LOG = 'debug'
process.env.OPENAI_CUSTOM_HEADERS = 'x-private-header: PRIVATE_HEADER'
const fixture = await startProvider()
const ai = createAi({ AI_MODEL: 'fixture-model', AI_BASE_URL: fixture.baseUrl, AI_TIMEOUT_SECONDS: '1' })
const input = (mode: string) => ({ messages: [{ role: 'user' as const, content: mode }] })
async function fails(action: () => unknown, code: string) {
  try { await action(); assert.fail(`Expected ${code}`) }
  catch (error) {
    assert(error instanceof AiError)
    assert.equal(error.code, code)
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
  assert(getAi(), 'Singleton itself is backendless')
  assert.equal(resolveAiConfig({ AI_MODEL: '模型😀' }).model, '模型😀')
  assert.equal(resolveAiConfig({ AI_MODEL: 'x' }).provider, 'openai-compatible')
  assert.equal(resolveAiConfig({ AI_MODEL: 'x' }).timeoutSeconds, 60)
  assert.equal(resolveAiConfig({ AI_MODEL: 'x' }).baseUrl, 'https://api.openai.com/v1')
  for (const env of [{}, { AI_MODEL: '' }, { AI_MODEL: 'x\n' }, { AI_MODEL: 'x'.repeat(129) }, { AI_MODEL: 'x', AI_PROVIDER: 'other' }, ...['0','301','1.5','NaN',''].map(AI_TIMEOUT_SECONDS => ({ AI_MODEL: 'x', AI_TIMEOUT_SECONDS })), ...['http://example.com/v1','ftp://localhost','https://user:secret@example.com','https://example.com?secret=x'].map(AI_BASE_URL => ({ AI_MODEL: 'x', AI_BASE_URL }))]) {
    assert.throws(() => resolveAiConfig(env), { code: 'configuration' })
  }
  await fails(() => createAi({}).generateText(input('completion')), 'configuration')
  assert.equal(validateAiInput({ messages: [{ role: 'system', content: 'é'.repeat(32768) }], temperature: 2, maxOutputTokens: 65536 }).messages.length, 1)
  for (const value of [ { messages: [] }, { messages: Array(101).fill({ role: 'user', content: '' }) }, { messages: [{ role: 'tool', content: '' }] }, { messages: [{ role: 'user', content: ['image'] }] }, input('é'.repeat(32769)), { messages: Array(5).fill({ role: 'user', content: 'x'.repeat(65536) }) }, { ...input('x'), temperature: NaN }, { ...input('x'), temperature: 2.1 }, { ...input('x'), maxOutputTokens: 1.5 }, { ...input('x'), tools: [] } ]) {
    await fails(() => ai.generateText(value as Parameters<typeof ai.generateText>[0]), 'invalid-request')
  }
  assert.deepEqual(await ai.generateText(input('completion')), { text: 'hello world', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } })
  await createAi({ AI_MODEL: 'fixture-model', AI_BASE_URL: fixture.baseUrl, AI_API_KEY: 'fixture-test-key' }).generateText(input('key'))
  assert(fixture.authenticated.key, 'Configured key is used only server-side')
  for (const [mode, reason] of [['length','length'],['filter','content-filter'],['other','other']]) assert.equal((await ai.generateText(input(mode!))).finishReason, reason)
  assert.equal((await ai.generateText(input('bad-usage'))).usage, undefined)
  assert.deepEqual((await ai.generateStructured(input('json'), z.object({ value: z.string() }))).data, { value: 'ok' })
  for (const mode of ['schema','malformed','json-length']) await fails(() => ai.generateStructured(input(mode), z.object({ value: z.string() })), 'invalid-output')
  const events = []
  for await (const event of ai.streamText(input('stream'))) {
    if (events.length === 0) assert(!fixture.completed.stream, 'First delta precedes final provider output')
    events.push(event)
  }
  assert.deepEqual(events, [{ type: 'text-delta', text: 'hello ' }, { type: 'text-delta', text: 'world' }, { type: 'finish', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }])
  for (const [mode, code] of [['auth','authentication'],['forbidden','authentication'],['rate','rate-limit'],['unavailable','unavailable'],['invalid','invalid-request'],['incomplete','invalid-output'],['stream-error','unknown'],['oversized','invalid-output']]) {
    await fails(() => ai.generateText(input(mode!)), code!)
    assert.equal(fixture.requests[mode!], 1, 'No automatic retry')
  }
  assert.equal(Buffer.byteLength((await ai.generateText(input('limit'))).text), 1048576, 'Exact UTF-8 cap succeeds')
  await fails(() => ai.generateStructured(input('oversized'), z.any()), 'invalid-output')
  await fails(async () => { for await (const _event of ai.streamText(input('oversized'))) { /* Consume. */ } }, 'invalid-output')
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
  console.info('[ai] Actual OpenAI adapter contract passed')
}
finally { await fixture.close() }
