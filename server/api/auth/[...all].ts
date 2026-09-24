export default defineEventHandler(event=>useServerAuth().handler!(toWebRequest(event)))
