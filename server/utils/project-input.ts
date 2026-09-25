import { z } from 'zod'

export const projectInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(1000).optional().transform(value => value || null),
})

export async function readProjectInput(event: Parameters<typeof readValidatedBody>[0]) {
  return readValidatedBody(event, body => projectInput.parse(body))
}
