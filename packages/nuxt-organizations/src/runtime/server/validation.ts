import { OrganizationError } from './errors'

function hasControls(value: string) {
  return [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}

export function opaqueId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || hasControls(value)) throw new OrganizationError('invalid-input')
  return value
}
export function organizationName(value: unknown): string {
  if (typeof value !== 'string') throw new OrganizationError('invalid-input')
  const name = value.trim()
  if (!name || name.length > 100 || hasControls(name)) throw new OrganizationError('invalid-input')
  return name
}
export function organizationSlug(value: unknown): string {
  if (typeof value !== 'string') throw new OrganizationError('invalid-input')
  const slug = value.trim().toLowerCase()
  if (slug.length < 3 || slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new OrganizationError('invalid-input')
  return slug
}
export type OrganizationRole = 'owner' | 'admin' | 'member'
export function memberRole(value: unknown): OrganizationRole {
  if (value !== 'owner' && value !== 'admin' && value !== 'member') throw new OrganizationError('invalid-input')
  return value
}
export function invitationEmail(value: unknown): string {
  if (typeof value !== 'string') throw new OrganizationError('invalid-input')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || hasControls(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OrganizationError('invalid-input')
  return email
}
function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === '') return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new OrganizationError('configuration')
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new OrganizationError('configuration')
  return number
}
export function resolveOrganizationsConfig(env: Record<string, string | undefined> = process.env) {
  return Object.freeze({
    organizationLimit: integer(env.ORGANIZATIONS_CREATION_LIMIT, 10, 1, 100),
    membershipLimit: integer(env.ORGANIZATIONS_MEMBERSHIP_LIMIT, 100, 1, 1000),
    invitationLimit: integer(env.ORGANIZATIONS_INVITATION_LIMIT, 100, 1, 1000),
    invitationExpiresIn: integer(env.ORGANIZATIONS_INVITATION_TTL_SECONDS, 172800, 300, 604800),
  })
}
export function organizationFields(input: Record<string, unknown>, create: boolean) {
  for (const key of Object.keys(input)) if (!['name', 'slug'].includes(key)) throw new OrganizationError('invalid-input')
  const data: { name?: string, slug?: string } = {}
  if (create || input.name !== undefined) data.name = organizationName(input.name)
  if (create || input.slug !== undefined) data.slug = organizationSlug(input.slug)
  if (!Object.keys(data).length) throw new OrganizationError('invalid-input')
  return data
}
