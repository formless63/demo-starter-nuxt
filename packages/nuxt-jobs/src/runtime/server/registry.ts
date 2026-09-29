import type { ZodType } from 'zod'
import type { AnyJobDefinition, JobDefinition, JobRegistry } from './types'

export function defineJob<const Name extends string, Schema extends ZodType, Result = unknown>(
  definition: JobDefinition<Name, Schema, Result>,
) {
  return definition
}

export function defineJobRegistry<const Definitions extends readonly AnyJobDefinition[]>(
  ...definitions: Definitions
) {
  return Object.fromEntries(definitions.map(definition => [definition.name, definition])) as {
    [Definition in Definitions[number] as Definition['name']]: Definition
  }
}

export function getJobDefinition<Registry extends JobRegistry>(
  registry: Registry,
  name: keyof Registry,
) {
  const definition = registry[name]
  if (!definition) {
    throw new Error(`Unknown job: ${String(name)}`)
  }
  return definition
}
