import { createOpsService, type OpsApplication } from '@repo/nuxt-ops-admin/server'
export const opsApplication: OpsApplication = { resolveSession: event => useServerAuth().api.getSession({ headers: event.headers }), service: createOpsService([]) }
