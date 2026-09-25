import { updateProject } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readProjectInput(event)
  const row = await updateProject(useDb(), user.id, getRouterParam(event, 'id')!, input)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  return row
})
