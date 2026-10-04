import { projectCredentialActions } from '../../../utils/application-policy'
import { listProjectsContract } from '../../../api-platform/contracts'
import { serializeProject } from '../../../api-platform/projects'
import { listProjects } from '../../../services/projects'

export default defineObservedApiHandler(listProjectsContract.operationId, async (event) => {
  const principal = await requireApiKey(event, listProjectsContract.auth.permissions)
  const projects = await listProjects(useDb(), principal.userId, projectCredentialActions(principal.permissions))
  return parseApiResponse(listProjectsContract.responses[200].schema, projects.map(serializeProject))
})
