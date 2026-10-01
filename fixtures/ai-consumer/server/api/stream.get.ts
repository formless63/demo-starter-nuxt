import { AiError } from '@repo/nuxt-ai/server'

export default defineEventHandler((event) => {
  const controller = new AbortController()
  event.node.res.once('close', () => controller.abort())
  const iterator = getAi().streamText({ messages: [{ role: 'user', content: 'cancel' }] }, { signal: controller.signal })
  return sendStream(event, new ReadableStream({
    async pull(stream) {
      try {
        const next = await iterator.next()
        if (next.done) stream.close()
        else stream.enqueue(new TextEncoder().encode(`${JSON.stringify(next.value)}\n`))
      }
      catch (error) { stream.error(error instanceof AiError ? error : new AiError('unknown')) }
    },
    async cancel() { controller.abort(); await iterator.return?.() },
  }))
})
