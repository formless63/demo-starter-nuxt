export default defineEventHandler(async () => {
  const result = await getAi().generateText({ messages: [{ role: 'user', content: 'completion' }] })
  return { ok: result.text === 'hello world' && result.finishReason === 'stop' }
})
