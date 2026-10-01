import type { Queue, SendOptions, WorkOptions } from 'pg-boss'
import type { z, ZodType } from 'zod'

export interface JobContext {
  id: string
  signal: AbortSignal
  retryCount: number
  retryLimit?: number
}

type JobHandler<Payload, Result> = {
  bivarianceHack(payload: Payload, context: JobContext): Promise<Result> | Result
}['bivarianceHack']

export interface JobDefinition<Name extends string, Schema extends ZodType, Result = unknown> {
  name: Name
  payload: Schema
  queue?: Omit<Queue, 'name'>
  send?: Omit<SendOptions, 'db'>
  work?: Omit<WorkOptions, 'localConcurrency'>
  handler: JobHandler<z.output<Schema>, Result>
}

export type AnyJobDefinition = JobDefinition<string, ZodType, unknown>
export type JobRegistry = Record<string, AnyJobDefinition>
export type JobName<Registry extends JobRegistry> = Extract<keyof Registry, string>
export type JobPayload<Registry extends JobRegistry, Name extends JobName<Registry>> =
  z.input<Registry[Name]['payload']>

export interface JobsRuntimeConfig {
  databaseUrl: string
  schema: string
  concurrency: number
  useListenNotify: boolean
}
