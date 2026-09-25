import { getProject } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const row = await getProject(useDb(), user.id, getRouterParam(event, 'id')!)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  return row
})
