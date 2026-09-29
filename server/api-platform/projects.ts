type ProjectRecord = {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

export function serializeProject(project: ProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}
