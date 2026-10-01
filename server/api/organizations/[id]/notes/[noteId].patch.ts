import { opaqueId } from '@repo/nuxt-organizations/server'
import { updateOrganizationNote } from '../../../../services/organization-notes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  try { return await updateOrganizationNote(useDb(), user, organizationRouteId(event), opaqueId(getRouterParam(event, 'noteId')), await organizationNoteTitle(event)) }
  catch (error) { throw organizationHttpError(error) }
})
