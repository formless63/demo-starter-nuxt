export default defineNuxtRouteMiddleware(async () => {
  const { session } = useAuth()
  if (import.meta.server) await session.value.refetch()
  if (!session.value.data) return navigateTo('/?redirect=/app/projects')
})
