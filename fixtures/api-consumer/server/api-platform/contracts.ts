import { z } from 'zod'
import { defineApiContract, defineApiRegistry } from '@repo/nuxt-api/server'

export const projectResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).meta({ id: 'Project' })

export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().transform(value => value || null),
}).meta({ id: 'CreateProject' })

export const listProjectsContract = defineApiContract({
  method: 'get',
  path: '/api/v1/projects',
  operationId: 'listProjects',
  summary: 'List projects',
  tags: ['Projects'],
  responses: { 200: { description: 'Owner-scoped projects', schema: z.array(projectResponseSchema) } },
  auth: { permissions: { projects: ['read'] } },
})

export const createProjectContract = defineApiContract({
  method: 'post',
  path: '/api/v1/projects',
  operationId: 'createProject',
  summary: 'Create a project',
  tags: ['Projects'],
  request: { body: createProjectBodySchema },
  responses: { 201: { description: 'Created project', schema: projectResponseSchema } },
  auth: { permissions: { projects: ['write'] } },
})

export const apiContracts = defineApiRegistry(listProjectsContract, createProjectContract)
