import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import type { ZodType } from 'zod'
import { ZodError } from 'zod'

export type ApiErrorCode =
  | 'bad_request'
  | 'forbidden'
  | 'internal_error'
  | 'not_found'
  | 'rate_limited'
  | 'unauthorized'
  | 'validation_failed'

export class ApiPlatformError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export function apiError(statusCode: number, code: ApiErrorCode, message: string): never {
  throw new ApiPlatformError(statusCode, code, message)
}

function statusCode(error: unknown) {
  if (error instanceof ApiPlatformError) return error.statusCode
  if (error instanceof ZodError) return 422
  if (typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  return 500
}

function errorCode(status: number): ApiErrorCode {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 422) return 'validation_failed'
  if (status === 429) return 'rate_limited'
  return 'internal_error'
}

function safeMessage(error: unknown, status: number) {
  if (status >= 500) return 'An internal error occurred'
  if (error instanceof Error && error.message) return error.message
  return 'The request could not be completed'
}

export function defineApiHandler<Request extends EventHandlerRequest, Response>(
  handler: EventHandler<Request, Response>,
) {
  return defineEventHandler<Request>(async (event) => {
    try {
      return await handler(event)
    }
    catch (error) {
      const status = statusCode(error)
      setResponseStatus(event, status)
      return {
        error: {
          code: error instanceof ApiPlatformError ? error.code : errorCode(status),
          message: safeMessage(error, status),
        },
      }
    }
  })
}

export async function readApiBody<Schema extends ZodType>(event: H3Event, schema: Schema) {
  const parsed = await schema.safeParseAsync(await readBody(event))
  if (!parsed.success) apiError(422, 'validation_failed', 'Request body is invalid')
  return parsed.data
}

export async function parseApiResponse<Schema extends ZodType>(schema: Schema, value: unknown) {
  const parsed = await schema.safeParseAsync(value)
  if (!parsed.success) {
    console.error('[api-platform] response contract validation failed')
    apiError(500, 'internal_error', 'Response contract validation failed')
  }
  return parsed.data
}
