import { getAi } from '@repo/nuxt-ai/server'
import type { AiInput, AiOperationOptions, AiTextResult } from '@repo/nuxt-ai/server'
import { getLogger, getMeter } from '@repo/nuxt-observability/server'

// Application-owned integration. Neither package depends on the other.
export async function generateObservedText(input: AiInput, options?: AiOperationOptions): Promise<AiTextResult> {
  const start = performance.now()
  let result: AiTextResult | undefined
  let outcome: 'success' | 'error' = 'error'
  try { result = await getAi().generateText(input, options); outcome = 'success'; return result }
  finally {
    // Instrumentation is fail-open, including implementations returning promises.
    const observe = (action: () => unknown) => {
      try { void Promise.resolve(action()).catch(() => {}) }
      catch { /* Optional telemetry cannot replace an AI result or safe failure. */ }
    }
    const duration = (performance.now() - start) / 1000
    const attributes = { operation: 'generate-text', provider: 'openai-compatible', outcome }
    observe(() => getMeter().createHistogram('app.ai.duration', { unit: 's' }).record(duration, attributes))
    for (const [name, count] of Object.entries(result?.usage ?? {})) {
      if (count !== undefined) observe(() => getMeter().createHistogram(`app.ai.${name}`).record(count, attributes))
    }
    observe(() => getLogger().info({ ...attributes, duration, ...(result ? { finishReason: result.finishReason, usage: result.usage } : {}) }, 'ai.operation'))
  }
}
