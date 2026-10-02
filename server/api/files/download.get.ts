import { useFileHttpHandler } from '../../utils/file-ui'
export default defineEventHandler(event => useFileHttpHandler()(event, 'download'))
