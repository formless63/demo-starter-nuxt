import { deleteProject } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const row = await deleteProject(useDb(), user.id, getRouterParam(event, 'id')!)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  setResponseStatus(event, 204)
  return null
})
