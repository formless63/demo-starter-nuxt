import type { Queue, SendOptions, WorkOptions } from 'pg-boss'
import type { ZodType, z  } from 'zod'

export interface JobContext {
  id: string
  signal: AbortSignal
}

export interface JobDefinition<Name extends string, Schema extends ZodType, Result = unknown> {
  name: Name
  payload: Schema
  queue?: Omit<Queue, 'name'>
  send?: Omit<SendOptions, 'db'>
  work?: Omit<WorkOptions, 'localConcurrency'>
  handler: (payload: z.output<Schema>, context: JobContext) => Promise<Result> | Result
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
