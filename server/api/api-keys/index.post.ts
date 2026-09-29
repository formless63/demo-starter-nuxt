import { createApiKeyInput, toSafeApiKey } from '../../utils/api-keys'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readValidatedBody(event, body => createApiKeyInput.parse(body))
  const actions = [
    ...(input.permissions.read ? ['read'] : []),
    ...(input.permissions.write ? ['write'] : []),
  ]
  const created = await useServerAuth().api.createApiKey({
    body: {
      name: input.name,
      userId: user.id,
      expiresIn: input.expiresInDays ? input.expiresInDays * 24 * 60 * 60 : null,
      permissions: { projects: actions },
    },
  })

  setResponseStatus(event, 201)
  return { ...toSafeApiKey(created), secret: created.key }
})
