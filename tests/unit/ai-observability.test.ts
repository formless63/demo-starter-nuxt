import { describe, expect, it, vi } from 'vitest'
import { AiError, getAi } from '@repo/nuxt-ai/server'
import { getLogger, getMeter } from '@repo/nuxt-observability/server'
import { generateObservedText } from '../../server/utils/observed-ai'

describe('optional AI telemetry privacy', () => {
  it('records only finite operation facts and validated usage, omitting prompts/output/errors/model', async () => {
    const ai = getAi()
    const generate = vi.spyOn(ai, 'generateText')
    generate.mockResolvedValueOnce({ text: 'PRIVATE_OUTPUT', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } })
    generate.mockRejectedValueOnce(new AiError('authentication'))
    const log = vi.spyOn(getLogger(), 'info')
    const record = vi.fn()
    vi.spyOn(getMeter(), 'createHistogram').mockReturnValue({ record } as ReturnType<ReturnType<typeof getMeter>['createHistogram']>)
    try {
      const input = { messages: [{ role: 'user' as const, content: 'PRIVATE_PROMPT' }] }
      expect((await generateObservedText(input)).text).toBe('PRIVATE_OUTPUT')
      await expect(generateObservedText(input)).rejects.toMatchObject({ code: 'authentication' })
      expect(log.mock.calls).toContainEqual([expect.objectContaining({ operation: 'generate-text', provider: 'openai-compatible', outcome: 'success', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }), 'ai.operation'])
      expect(log.mock.calls).toContainEqual([expect.objectContaining({ outcome: 'error' }), 'ai.operation'])
      for (const [, attributes] of record.mock.calls) expect(Object.keys(attributes).sort()).toEqual(['operation', 'outcome', 'provider'])
      for (const [fields] of log.mock.calls) expect(Object.keys(fields).every(key => ['operation', 'provider', 'outcome', 'duration', 'finishReason', 'usage'].includes(key))).toBe(true)
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE')
      expect(JSON.stringify(record.mock.calls)).not.toContain('PRIVATE')
    }
    finally { vi.restoreAllMocks() }
  })
  it.each(['throw', 'reject'] as const)('preserves success and safe failure when telemetry functions %s', async (mode) => {
    const fail = () => { if (mode === 'throw') throw new Error('PRIVATE_TELEMETRY'); return Promise.reject(new Error('PRIVATE_TELEMETRY')) }
    const generate = vi.spyOn(getAi(), 'generateText')
    const original = new AiError('authentication')
    generate.mockResolvedValueOnce({ text: 'PRIVATE_OUTPUT', finishReason: 'stop' }).mockRejectedValueOnce(original)
    vi.spyOn(getMeter(), 'createHistogram').mockReturnValue({ record: fail } as never)
    vi.spyOn(getLogger(), 'info').mockImplementation(fail as never)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const input = { messages: [{ role: 'user' as const, content: 'PRIVATE_PROMPT' }] }
      expect((await generateObservedText(input)).text).toBe('PRIVATE_OUTPUT')
      await expect(generateObservedText(input)).rejects.toBe(original)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(unhandled).not.toHaveBeenCalled()
    }
    finally { process.off('unhandledRejection', unhandled); vi.restoreAllMocks() }
  })
  it('preserves success when obtaining the meter throws', async () => {
    vi.spyOn(getAi(), 'generateText').mockResolvedValue({ text: 'ok', finishReason: 'stop' })
    vi.spyOn(getMeter(), 'createHistogram').mockImplementation(() => { throw new Error('PRIVATE_METER') })
    try { expect((await generateObservedText({ messages: [{ role: 'user', content: 'hello' }] })).text).toBe('ok') }
    finally { vi.restoreAllMocks() }
  })

})
