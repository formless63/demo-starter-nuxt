import { createOpsService } from './index'
export const opsApplication = { resolveSession: async () => null, service: createOpsService([]) }
