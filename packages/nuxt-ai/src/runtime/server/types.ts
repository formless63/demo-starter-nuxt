export interface AiMessage { role: 'system' | 'user' | 'assistant', content: string }
export interface AiInput { messages: AiMessage[], temperature?: number, maxOutputTokens?: number }
export interface AiOperationOptions { signal?: AbortSignal }
export type AiFinishReason = 'stop' | 'length' | 'content-filter' | 'other'
export interface AiUsage { inputTokens?: number, outputTokens?: number, totalTokens?: number }
export interface AiTextResult { text: string, finishReason: AiFinishReason, usage?: AiUsage }
export interface AiStructuredResult<T> { data: T, finishReason: AiFinishReason, usage?: AiUsage }
export type AiStreamEvent = { type: 'text-delta', text: string } | { type: 'finish', finishReason: AiFinishReason, usage?: AiUsage }
export const AI_LIMITS = { messages: 100, messageBytes: 64 * 1024, inputBytes: 256 * 1024, outputBytes: 1024 * 1024 } as const
