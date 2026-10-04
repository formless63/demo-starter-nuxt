import { opaqueId, OrganizationError } from '@repo/nuxt-organizations/server'
import type { H3Event } from 'h3'

export function organizationRouteId(event: H3Event) {
  return opaqueId(getRouterParam(event, 'id'))
}
export async function organizationNoteTitle(event: H3Event) {
  const input = await readBody<unknown>(event)
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'title') || !('title' in input) || typeof input.title !== 'string') throw new OrganizationError('invalid-input')
  const title = input.title.trim()
  if (!title || title.length > 120 || [...title].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new OrganizationError('invalid-input')
  return title
}
