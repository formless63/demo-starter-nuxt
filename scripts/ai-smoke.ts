import { AiError } from '@repo/nuxt-ai/server'
import { generateObservedText } from '../server/utils/observed-ai'

// Explicit opt-in operation only; no startup route/plugin or generated content logging.
try {
  const result = await generateObservedText({ messages: [{ role: 'user', content: 'Reply with a short greeting.' }], maxOutputTokens: 32 })
  console.info('[ai]', { finishReason: result.finishReason, usage: result.usage })
}
catch (error) {
  console.error('[ai]', error instanceof AiError ? error.toJSON() : new AiError('unknown').toJSON())
  process.exitCode = 1
}
