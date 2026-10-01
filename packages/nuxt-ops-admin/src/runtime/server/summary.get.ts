import { defineEventHandler, setResponseStatus, setHeader } from 'h3'
// Application-owned server module; never part of the client graph.
// @ts-expect-error Consumer module alias is installed by Nuxt setup.
import { opsApplication } from '#ops-admin-application'
import { authorizeOps, OpsError } from './index'
import type { OpsApplication } from './index'
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  try {
    const application = opsApplication as OpsApplication
    await authorizeOps(application, event)
    const controller = new AbortController()
    const close = () => { if (!event.node.res.writableEnded) controller.abort() }
    event.node.res.once('close', close)
    try { return await application.service.summary(controller.signal) }
    finally { event.node.res.removeListener('close', close) }
  }
  catch (cause) {
    const error = cause instanceof OpsError ? cause : new OpsError('unavailable')
    setResponseStatus(event, error.statusCode)
    return error.toJSON()
  }
})
