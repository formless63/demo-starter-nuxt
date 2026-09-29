export function serializeProject(project: {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}
