import { useRuntimeConfig } from '#imports'
import { defineEventHandler } from 'h3'
import { apiContracts } from '#api-platform-contracts'
import { createOpenApiDocument } from './contracts'

export default defineEventHandler((): object => {
  const config = useRuntimeConfig().apiPlatform
  return createOpenApiDocument(apiContracts, {
    title: config.title,
    version: config.version,
    description: config.description,
  })
})
