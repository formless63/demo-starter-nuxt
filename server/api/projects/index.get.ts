import { listProjects } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return listProjects(useDb(), user.id)
})
