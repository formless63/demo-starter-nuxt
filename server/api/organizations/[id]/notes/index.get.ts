import { listOrganizationNotes } from '../../../../services/organization-notes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  try { return await listOrganizationNotes(useDb(), user, organizationRouteId(event)) }
  catch (error) { throw organizationHttpError(error) }
})
