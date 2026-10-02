import { createError, defineEventHandler, getRouterParam } from 'h3'
import { fileFixture } from '../../utils/file-fixture'

export default defineEventHandler((event) => {
  const action = getRouterParam(event, 'action')
  if (action !== 'list' && action !== 'upload' && action !== 'remove' && action !== 'download') throw createError({ statusCode: 404 })
  return fileFixture(event, action)
})
