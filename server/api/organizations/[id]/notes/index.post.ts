import { createOrganizationNote } from '../../../../services/organization-notes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  try {
    const title = await organizationNoteTitle(event)
    const result = await createOrganizationNote(useDb(), user, organizationRouteId(event), title)
    setResponseStatus(event, 201)
    return result
  }
  catch (error) { throw organizationHttpError(error) }
})
