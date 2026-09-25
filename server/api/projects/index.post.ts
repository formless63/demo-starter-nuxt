import { createProject } from '../../services/projects'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readProjectInput(event)
  const created = await createProject(useDb(), user.id, input)

  setResponseStatus(event, 201)
  return created
})
