import type { ZodType } from 'zod'
import { z } from 'zod'
import { createDocument, type oas31 } from 'zod-openapi'

export type ApiMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'
export type ApiPermissions = Record<string, string[]>

export interface ApiContract {
  method: ApiMethod
  path: `/api/v1/${string}`
  operationId: string
  summary: string
  description?: string
  tags: string[]
  request?: {
    params?: ZodType
    query?: ZodType
    body?: ZodType
  }
  responses: Record<number, { description: string, schema: ZodType }>
  auth: { permissions: ApiPermissions }
}

export interface ApiDocumentInfo {
  title: string
  version: string
  description?: string
}

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
}).meta({ id: 'ApiError' })

export function defineApiContract<const Contract extends ApiContract>(contract: Contract) {
  return contract
}

export function defineApiRegistry<const Contracts extends readonly ApiContract[]>(...contracts: Contracts) {
  const operationIds = new Set<string>()
  const operations = new Set<string>()

  for (const contract of contracts) {
    if (operationIds.has(contract.operationId)) {
      throw new Error(`Duplicate API operationId: ${contract.operationId}`)
    }
    operationIds.add(contract.operationId)

    const operation = `${contract.method.toUpperCase()} ${contract.path}`
    if (operations.has(operation)) throw new Error(`Duplicate API operation: ${operation}`)
    operations.add(operation)
  }

  return [...contracts].sort((left, right) =>
    left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  )
}

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: apiErrorSchema } },
  }
}

const standardErrors = {
  400: errorResponse('Malformed request'),
  401: errorResponse('Missing or invalid API key'),
  403: errorResponse('API key lacks a required permission'),
  404: errorResponse('Resource not found'),
  422: errorResponse('Request validation failed'),
  429: errorResponse('API key rate limit exceeded'),
  500: errorResponse('Internal server error'),
}

export function createOpenApiDocument(
  contracts: readonly ApiContract[],
  info: ApiDocumentInfo,
): oas31.OpenAPIObject {
  const registry = defineApiRegistry(...contracts)
  const paths: Record<string, Record<string, unknown>> = {}
  const tags = new Set<string>()

  for (const contract of registry) {
    contract.tags.forEach(tag => tags.add(tag))
    const responses: Record<number, unknown> = { ...standardErrors }
    for (const [status, response] of Object.entries(contract.responses)) {
      responses[Number(status)] = {
        description: response.description,
        content: { 'application/json': { schema: response.schema } },
      }
    }

    const operation: Record<string, unknown> = {
      operationId: contract.operationId,
      summary: contract.summary,
      description: contract.description,
      tags: contract.tags,
      security: [{ ApiKeyAuth: [] }],
      'x-required-permissions': contract.auth.permissions,
      responses,
    }
    if (contract.request?.params || contract.request?.query) {
      operation.requestParams = {
        path: contract.request.params,
        query: contract.request.query,
      }
    }
    if (contract.request?.body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: contract.request.body } },
      }
    }

    paths[contract.path] ??= {}
    paths[contract.path]![contract.method] = operation
  }

  return createDocument({
    openapi: '3.1.1',
    info,
    tags: [...tags].sort().map(name => ({ name })),
    paths,
    components: {
      schemas: { ApiError: apiErrorSchema },
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'A user-owned API key. The secret is returned only when the key is created.',
        },
      },
    },
  } as Parameters<typeof createDocument>[0]) as oas31.OpenAPIObject
}
