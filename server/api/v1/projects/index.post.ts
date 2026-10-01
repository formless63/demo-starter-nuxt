import { createProjectContract } from '../../../api-platform/contracts'
import { serializeProject } from '../../../api-platform/projects'
import { createProject } from '../../../services/projects'

export default defineObservedApiHandler(createProjectContract.operationId, async (event) => {
  const principal = await requireApiKey(event, createProjectContract.auth.permissions)
  const input = await readApiBody(event, createProjectContract.request.body)
  const project = await createProject(useDb(), principal.userId, input, { type: 'machine', id: principal.keyId }, new Set(Object.entries(principal.permissions).flatMap(([resource, actions]) => actions.map(action => `${resource}.${action}`))))

  setResponseStatus(event, 201)
  return parseApiResponse(createProjectContract.responses[201].schema, serializeProject(project!))
})
