import { AiError } from './errors'

export interface AiConfig {
  provider: 'openai-compatible'
  model: string
  apiKey?: string
  baseUrl: string
  timeoutSeconds: number
}
// Deliberate literal loopback HTTP endpoints only. No general insecure transport flag.
export function resolveAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const provider = env.AI_PROVIDER ?? 'openai-compatible'
  const model = env.AI_MODEL
  const timeout = env.AI_TIMEOUT_SECONDS ?? '60'
  const baseUrl = env.AI_BASE_URL ?? 'https://api.openai.com/v1'
  if (provider !== 'openai-compatible' || typeof model !== 'string' || !model.trim() || !model.isWellFormed() || [...model].length < 1 || [...model].length > 128 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(model)
    || !/^\d+$/u.test(timeout) || Number(timeout) < 1 || Number(timeout) > 300) throw new AiError('configuration')
  let url: URL
  try { url = new URL(baseUrl) }
  catch { throw new AiError('configuration') }
  if (url.username || url.password || url.search || url.hash
    || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['development', 'test'].includes(env.NODE_ENV ?? '') && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/u.test(baseUrl) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new AiError('configuration')
  const apiKey = env.AI_API_KEY
  // Reject header controls without exposing the key or consulting OPENAI_* variables.
  if (apiKey !== undefined) {
    if (typeof apiKey !== 'string' || !apiKey.isWellFormed() || /\p{Cc}/u.test(apiKey) || [...apiKey].some(character => character.codePointAt(0)! > 255)) throw new AiError('configuration')
    // Headers trims trailing whitespace; never silently alter an accepted key.
    try { if (apiKey && new Headers({ Authorization: `Bearer ${apiKey}` }).get('Authorization') !== `Bearer ${apiKey}`) throw new AiError('configuration') }
    catch { throw new AiError('configuration') }
  }
  return { provider, model, baseUrl: url.href.replace(/\/$/u, ''), timeoutSeconds: Number(timeout), ...(apiKey ? { apiKey } : {}) }
}
